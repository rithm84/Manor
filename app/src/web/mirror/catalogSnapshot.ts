import { z } from 'zod'

import type { JsonObject } from '../ManorGateway'

/**
 * The published catalog snapshot, which lets a first sync download the shared problem catalog as one
 * compressed file instead of walking every row through the API.
 *
 * `tools/problem-import/catalog-snapshot.mjs` writes it to the private `manor-catalog` bucket after each import
 * run: `catalog/manifest.json` names the current snapshot, and the snapshot is gzip-compressed NDJSON whose
 * first line is a header and whose other lines each carry one `problem_catalog` or `problem_catalog_content` row.
 * The exporter reads the catalog head cursor before the rows, so anything committed during the export lands
 * after the header's cursor and reaches the copy through the catalog feed.
 *
 * Everything here is pure: `CatalogSync` downloads and decompresses, and these functions decide.
 */

export const CATALOG_BUCKET = 'manor-catalog'
export const CATALOG_MANIFEST_PATH = 'catalog/manifest.json'

/** A copy this far behind the feed head reads a newer snapshot instead of walking the changes one page at a time. */
export const CATALOG_SNAPSHOT_GAP = 5_000

const count = z.number().int().nonnegative()

const manifestSchema = z.object({
  schema: z.literal(1),
  cursor: count,
  path: z.string().regex(/^catalog\/\d+\.ndjson\.gz$/),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  problems: count,
  contents: count,
  createdAt: z.iso.datetime({ offset: true })
})
export type CatalogManifest = z.infer<typeof manifestSchema>

const headerSchema = z.object({ schema: z.literal(1), cursor: count, problems: count, contents: count })
export type CatalogSnapshotHeader = z.infer<typeof headerSchema>

/**
 * A row is checked at its envelope only. `JSON.parse` can only produce JSON, so validating every value again
 * would re-walk tens of megabytes of statements to learn nothing; the row's key columns are checked when it is
 * stored, and its fields when a page reads it.
 */
const snapshotRow = z.custom<JsonObject>((value) => typeof value === 'object' && value !== null && !Array.isArray(value), { message: 'A snapshot row is a JSON object' })
const entrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('problem'), row: snapshotRow }),
  z.object({ type: z.literal('content'), row: snapshotRow })
])
export type CatalogSnapshotEntry = { readonly type: 'problem' | 'content'; readonly row: JsonObject }

export function parseCatalogManifest(value: unknown): CatalogManifest {
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) throw new Error(`The catalog manifest is not in the expected form: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** How far a snapshot has been read: the header once seen, the rows counted so far, and an unfinished line. */
export interface SnapshotProgress {
  readonly header: CatalogSnapshotHeader | null
  readonly problems: number
  readonly contents: number
  /** Text after the last newline, which the next chunk completes. */
  readonly carry: string
  /** Lines read so far, for error messages. */
  readonly lines: number
}

export const SNAPSHOT_START: SnapshotProgress = { header: null, problems: 0, contents: 0, carry: '', lines: 0 }

function parseLine(line: string, number: number): unknown {
  try { return JSON.parse(line) }
  catch (cause: unknown) { throw new Error(`Catalog snapshot line ${number} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`) }
}

function readHeader(line: string, number: number, manifest: CatalogManifest): CatalogSnapshotHeader {
  const parsed = headerSchema.safeParse(parseLine(line, number))
  if (!parsed.success) throw new Error(`The catalog snapshot header is not in the expected form: ${z.prettifyError(parsed.error)}`)
  const header = parsed.data
  if (header.cursor !== manifest.cursor || header.problems !== manifest.problems || header.contents !== manifest.contents) {
    throw new Error(`The catalog snapshot header (cursor ${header.cursor}, ${header.problems} problems, ${header.contents} statements) does not match its manifest (cursor ${manifest.cursor}, ${manifest.problems} problems, ${manifest.contents} statements)`)
  }
  return header
}

function readEntry(line: string, number: number): CatalogSnapshotEntry {
  const parsed = entrySchema.safeParse(parseLine(line, number))
  if (!parsed.success) throw new Error(`Catalog snapshot line ${number} is not a problem or statement row: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** Reads complete lines: the first non-empty one is the header, and every later one is a row. */
function readLines(progress: SnapshotProgress, lines: readonly string[], manifest: CatalogManifest): { progress: SnapshotProgress; entries: CatalogSnapshotEntry[] } {
  let { header, problems, contents, lines: read } = progress
  const entries: CatalogSnapshotEntry[] = []
  for (const line of lines) {
    read += 1
    if (line.trim() === '') continue
    if (header === null) { header = readHeader(line, read, manifest); continue }
    const entry = readEntry(line, read)
    if (entry.type === 'problem') problems += 1
    else contents += 1
    entries.push(entry)
  }
  return { progress: { header, problems, contents, carry: progress.carry, lines: read }, entries }
}

/** Reads one decompressed chunk of the snapshot and returns the rows it completed. */
export function readSnapshotChunk(progress: SnapshotProgress, chunk: string, manifest: CatalogManifest): { progress: SnapshotProgress; entries: CatalogSnapshotEntry[] } {
  const lines = (progress.carry + chunk).split('\n')
  const carry = lines.pop() ?? ''
  const result = readLines({ ...progress, carry: '' }, lines, manifest)
  return { progress: { ...result.progress, carry }, entries: result.entries }
}

/**
 * Reads the last line, which has no newline after it, and checks the snapshot was whole: a header, and as many
 * problem and statement rows as it promised. A short or padded snapshot is refused rather than half applied.
 */
export function finishSnapshot(progress: SnapshotProgress, manifest: CatalogManifest): { header: CatalogSnapshotHeader; entries: CatalogSnapshotEntry[] } {
  const { progress: last, entries } = readLines({ ...progress, carry: '' }, progress.carry === '' ? [] : [progress.carry], manifest)
  if (last.header === null) throw new Error('The catalog snapshot is empty; it has no header line')
  if (last.problems !== last.header.problems || last.contents !== last.header.contents) {
    throw new Error(`The catalog snapshot holds ${last.problems} problems and ${last.contents} statements but its header promises ${last.header.problems} and ${last.header.contents}`)
  }
  return { header: last.header, entries }
}

/** The local catalog copy as the mirror file records it. */
export interface CatalogCopy { readonly ready: boolean; readonly cursor: number }

/**
 * How a catalog pull catches up:
 * - `feed`: walk the catalog feed from the local cursor.
 * - `snapshot`: load the published snapshot, then walk the feed from its cursor.
 * - `tables`: read both catalog tables from the server, then walk the feed from the head read before them.
 *
 * A copy that is complete and within `CATALOG_SNAPSHOT_GAP` of the head walks the feed. Otherwise a snapshot
 * newer than the copy wins; a copy that must be rebuilt (never filled, or holding a cursor past the head, which
 * belongs to a history the server no longer has) and has no usable snapshot reads the tables, and a complete
 * copy that is merely far behind walks the feed anyway.
 */
export function catalogSyncPlan(copy: CatalogCopy, head: number, manifestCursor: number | null): 'feed' | 'snapshot' | 'tables' {
  const rebuild = !copy.ready || copy.cursor > head
  if (!rebuild && head - copy.cursor <= CATALOG_SNAPSHOT_GAP) return 'feed'
  if (manifestCursor !== null && (rebuild || manifestCursor > copy.cursor)) return 'snapshot'
  return rebuild ? 'tables' : 'feed'
}

/** Whether a catalog pull needs to read the manifest before choosing its plan. */
export function needsManifest(copy: CatalogCopy, head: number): boolean {
  return !copy.ready || copy.cursor > head || head - copy.cursor > CATALOG_SNAPSHOT_GAP
}
