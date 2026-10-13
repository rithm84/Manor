import { StorageApiError, type SupabaseClient } from '@supabase/supabase-js'

import type { WorkspaceRowChange } from '../../shared/workspaceChanges'
import { ManorConnectionError, ManorRequestError, type JsonObject, type ManorGateway } from '../ManorGateway'
import { splitCatalogRow } from './catalogRows'
import {
  CATALOG_BUCKET, CATALOG_MANIFEST_PATH, SNAPSHOT_START, catalogSyncPlan, finishSnapshot, needsManifest, parseCatalogManifest, readSnapshotChunk,
  type CatalogManifest, type CatalogSnapshotEntry
} from './catalogSnapshot'
import { IDENTITY_BATCH_LIMITS, readIdentityRows } from './identityReads'
import { MirrorAbandoned } from './MirrorAbandoned'
import type { MirrorRow, MirrorStatus, MirrorStore } from './MirrorStore'
import { CATALOG_DETAIL_TABLE, CATALOG_TABLES, isCatalogTable, rowKey, rowRevisionOf, type CatalogTable, type StoredTable } from './mirrorTables'
import { groupFeedChanges, planTableApply, type TableChanges } from './pullPlan'
import { CATALOG_FEED, FEED_PAGE_SIZE, WorkspaceFeed } from './WorkspaceFeed'

/** One pull walks at most this many feed pages; past it, the next pass loads a snapshot instead. */
const MAX_FEED_BATCHES = 100

/** Rows per store write while a snapshot loads, so no single IPC call carries megabytes of statements. */
const SNAPSHOT_WRITE_ROWS = 500

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A storage failure phrased like every other request failure: a dropped connection is not a refusal. */
function storageFailure(operation: string, error: Error): Error {
  if (error instanceof StorageApiError) return new ManorRequestError(operation, String(error.statusCode ?? error.status), error.message)
  return new ManorConnectionError(operation, error.message)
}

/** Whether Storage answered that the object does not exist, which for the manifest means none is published yet. */
function missingObject(error: Error): boolean {
  return error instanceof StorageApiError && (error.statusCode === '404' || error.status === 404)
}

/** The stored rows of a batch of `problem_catalog` rows: index rows, the detail rows some carry, and the keys whose detail is gone. */
function catalogParts(rows: readonly JsonObject[]): { index: MirrorRow[]; details: MirrorRow[]; bare: string[] } {
  const index: MirrorRow[] = []
  const details: MirrorRow[] = []
  const bare: string[] = []
  for (const row of rows) {
    const parts = splitCatalogRow(row)
    index.push(parts.index)
    if (parts.detail === null) bare.push(parts.index.key)
    else details.push(parts.detail)
  }
  return { index, details, bare }
}

/**
 * Writes a snapshot into the store a chunk at a time. The first write to each table replaces it, so problems the
 * snapshot no longer holds disappear, and later writes add to it; a table the snapshot holds no rows for is
 * emptied at the end. Detail rows are written before the index rows that point at them.
 */
class SnapshotWriter {
  private readonly started = new Set<StoredTable>()
  private problems: JsonObject[] = []
  private contents: JsonObject[] = []
  private readonly write: (table: StoredTable, rows: readonly MirrorRow[], replace: boolean) => Promise<void>

  constructor(write: (table: StoredTable, rows: readonly MirrorRow[], replace: boolean) => Promise<void>) {
    this.write = write
  }

  async add(entries: readonly CatalogSnapshotEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.type === 'problem') this.problems.push(entry.row)
      else this.contents.push(entry.row)
      if (this.problems.length >= SNAPSHOT_WRITE_ROWS) await this.flushProblems()
      if (this.contents.length >= SNAPSHOT_WRITE_ROWS) await this.flushContents()
    }
  }

  async finish(): Promise<void> {
    await this.flushProblems()
    await this.flushContents()
    for (const table of [CATALOG_DETAIL_TABLE, 'problem_catalog', 'problem_catalog_content'] as const) {
      if (!this.started.has(table)) await this.store(table, [])
    }
  }

  private async flushProblems(): Promise<void> {
    if (this.problems.length === 0) return
    const { index, details } = catalogParts(this.problems)
    this.problems = []
    if (details.length > 0) await this.store(CATALOG_DETAIL_TABLE, details)
    await this.store('problem_catalog', index)
  }

  private async flushContents(): Promise<void> {
    if (this.contents.length === 0) return
    const rows = this.contents.map((row) => ({ key: rowKey('problem_catalog_content', row), data: row, revision: rowRevisionOf(row) }))
    this.contents = []
    await this.store('problem_catalog_content', rows)
  }

  private async store(table: StoredTable, rows: readonly MirrorRow[]): Promise<void> {
    const replace = !this.started.has(table)
    this.started.add(table)
    await this.write(table, rows, replace)
  }
}

/**
 * Keeps the shared problem catalog in the local mirror current and says when it can answer reads.
 *
 * The catalog is the same for every account, so it does not ride the account's change feed: a first sync
 * downloads the published snapshot (`catalogSnapshot.ts`), and from then on the copy walks
 * `manor_catalog_changes` past its own cursor, re-reading changed rows without an owner filter and deleting
 * the ones the feed reports deleted or that no longer come back. Until the copy is complete, catalog reads
 * go to the server.
 *
 * `MirrorSync` owns one and forwards its pokes (launch, focus, coming back online, the one-minute timer). It
 * runs on a chain of its own: its tables and meta keys are disjoint from the account copy's, every store call
 * is its own transaction, and a snapshot download must never hold up the pull that follows a save.
 */
export class CatalogSync {
  private readonly gateway: ManorGateway
  private readonly store: MirrorStore
  private readonly client: SupabaseClient
  private readonly feed: WorkspaceFeed
  /** The shell handed over a mirror file. */
  private available = false
  /** The copy holds the whole catalog as of `cursor`. */
  private ready = false
  /** The copy is current enough to answer reads. */
  private serving = false
  private stopped = false
  private cursor = 0
  private chain: Promise<void> = Promise.resolve()
  private queued: Promise<void> | null = null

  constructor(gateway: ManorGateway, store: MirrorStore, client: SupabaseClient) {
    this.gateway = gateway
    this.store = store
    this.client = client
    this.feed = new WorkspaceFeed(client, CATALOG_FEED)
  }

  /** Adopts what the opened mirror file says about its catalog copy. */
  open(status: MirrorStatus): void {
    this.available = true
    this.cursor = status.catalogCursor
    this.ready = status.catalogReady
    this.serving = status.catalogReady
  }

  stop(): void {
    this.stopped = true
    this.serving = false
  }

  /** Whether catalog reads are answered from the mirror right now. */
  isServing(): boolean {
    return this.serving
  }

  /** Catches the catalog up. Pokes that arrive while one pull runs collapse into a single follow-up. */
  pull(): Promise<void> {
    if (this.queued !== null) return this.queued
    const work = (): Promise<void> => {
      this.queued = null
      return this.run()
    }
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => undefined)
    this.queued = run
    return run
  }

  private guardRunning(): void {
    if (this.stopped) throw new MirrorAbandoned(this.gateway.accountId)
  }

  private async run(): Promise<void> {
    if (this.stopped || !this.available) return
    try {
      const head = await this.feed.cursor()
      const copy = { ready: this.ready, cursor: this.cursor }
      if (needsManifest(copy, head)) {
        const manifest = await this.readManifest()
        const plan = catalogSyncPlan(copy, head, manifest?.cursor ?? null)
        if (plan === 'snapshot') {
          if (manifest === null) throw new Error('The catalog plan chose a snapshot without a manifest')
          await this.loadSnapshot(manifest)
        } else if (plan === 'tables') {
          await this.loadTables(head)
        }
      }
      await this.applyFeed()
      this.serving = this.ready
    } catch (cause: unknown) {
      if (cause instanceof MirrorAbandoned) return
      const offline = cause instanceof ManorConnectionError
      // Offline is what the copy is for; any other failure may have left it wrong, so reads go back to the server.
      if (!offline) this.serving = false
      console.error('Manor could not refresh the problem catalog in the local mirror', {
        accountId: this.gateway.accountId, cursor: this.cursor, ready: this.ready, offline, cause: detail(cause)
      })
    }
  }

  /** The published manifest, or null when none is published yet; a first sync then reads the tables instead. */
  private async readManifest(): Promise<CatalogManifest | null> {
    const { data, error } = await this.client.storage.from(CATALOG_BUCKET).download(CATALOG_MANIFEST_PATH)
    if (error !== null) {
      if (missingObject(error)) {
        console.warn('No problem catalog snapshot is published, so the catalog copy reads the tables instead', { bucket: CATALOG_BUCKET, path: CATALOG_MANIFEST_PATH })
        return null
      }
      throw storageFailure('Read the problem catalog manifest', error)
    }
    return parseCatalogManifest(JSON.parse(await data.text()))
  }

  /** Marks the copy incomplete before rewriting it, so an interrupted fill starts over instead of serving half a catalog. */
  private async startFill(): Promise<void> {
    this.guardRunning()
    this.serving = false
    this.ready = false
    await this.store.commitCatalog(this.gateway.accountId, this.cursor, false)
  }

  private async finishFill(cursor: number): Promise<void> {
    this.guardRunning()
    await this.store.commitCatalog(this.gateway.accountId, cursor, true)
    this.cursor = cursor
    this.ready = true
    this.serving = true
    await this.gateway.invalidateTables(CATALOG_TABLES)
    this.announce([...CATALOG_TABLES].map((table) => ({ table, id: null, revision: null, action: 'reread' })))
  }

  private async writeStored(table: StoredTable, rows: readonly MirrorRow[], replace: boolean): Promise<void> {
    this.guardRunning()
    if (replace) await this.store.replaceTable(this.gateway.accountId, table, rows)
    else await this.store.upsertRows(this.gateway.accountId, table, rows)
  }

  /** Downloads the snapshot, checks it against its manifest, and streams its rows into the copy. */
  private async loadSnapshot(manifest: CatalogManifest): Promise<void> {
    const { data, error } = await this.client.storage.from(CATALOG_BUCKET).download(manifest.path)
    if (error !== null) throw storageFailure('Download the problem catalog snapshot', error)
    const bytes = await data.arrayBuffer()
    if (bytes.byteLength !== manifest.bytes) throw new Error(`The catalog snapshot ${manifest.path} is ${bytes.byteLength} bytes but its manifest says ${manifest.bytes}`)
    const digest = hex(await crypto.subtle.digest('SHA-256', bytes))
    if (digest !== manifest.sha256) throw new Error(`The catalog snapshot ${manifest.path} has SHA-256 ${digest} but its manifest says ${manifest.sha256}`)
    await this.startFill()
    const writer = new SnapshotWriter((table, rows, replace) => this.writeStored(table, rows, replace))
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader()
    let progress = SNAPSHOT_START
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const read = readSnapshotChunk(progress, value, manifest)
      progress = read.progress
      await writer.add(read.entries)
    }
    const last = finishSnapshot(progress, manifest)
    await writer.add(last.entries)
    await writer.finish()
    await this.finishFill(last.header.cursor)
  }

  /** Reads both catalog tables from the server. `head` was read first, so anything committed meanwhile follows as feed changes. */
  private async loadTables(head: number): Promise<void> {
    await this.startFill()
    const problems = await this.gateway.readRowsFromServer('problem_catalog', [])
    const { index, details } = catalogParts(problems)
    await this.writeStored(CATALOG_DETAIL_TABLE, details, true)
    await this.writeStored('problem_catalog', index, true)
    const contents = await this.gateway.readRowsFromServer('problem_catalog_content', [])
    await this.writeStored('problem_catalog_content', contents.map((row) => ({ key: rowKey('problem_catalog_content', row), data: row, revision: rowRevisionOf(row) })), true)
    await this.finishFill(head)
  }

  private async applyFeed(): Promise<void> {
    if (!this.ready) throw new Error('The problem catalog walks its feed only once the copy is complete')
    const touched = new Set<CatalogTable>()
    const rows: WorkspaceRowChange[] = []
    for (let page = 0; ; page += 1) {
      if (page === MAX_FEED_BATCHES) {
        this.ready = false
        throw new RangeError(`The catalog feed offered more than ${MAX_FEED_BATCHES * FEED_PAGE_SIZE} changes at once; the next pass loads a snapshot instead`)
      }
      const changes = await this.feed.changes(this.cursor, FEED_PAGE_SIZE)
      this.guardRunning()
      if (changes.length === 0) break
      const batch = groupFeedChanges(changes, this.cursor)
      if (batch.ignored.size > 0) throw new Error(`The catalog feed named object types the catalog does not hold: ${[...batch.ignored].join(', ')}`)
      for (const [table, tableChanges] of batch.tables) {
        if (!isCatalogTable(table)) throw new Error(`The catalog feed named ${table}, which is not a catalog table`)
        await this.applyTable(table, tableChanges)
        touched.add(table)
        if (tableChanges.fullRefresh) rows.push({ table, id: null, revision: null, action: 'reread' })
        for (const change of tableChanges.byKey.values()) {
          rows.push({ table, id: change.identity.get('id') ?? change.identity.get('problem_id') ?? null, revision: change.revision, action: change.action })
        }
      }
      this.guardRunning()
      await this.store.commitCatalog(this.gateway.accountId, batch.lastCursor, true)
      this.cursor = batch.lastCursor
      if (changes.length < FEED_PAGE_SIZE) break
    }
    if (touched.size === 0) return
    await this.gateway.invalidateTables([...touched])
    this.announce(rows)
  }

  /** Deletes what the feed removed or what no longer comes back, and stores what was re-read. */
  private async applyTable(table: CatalogTable, changes: TableChanges): Promise<void> {
    this.guardRunning()
    if (changes.fullRefresh) throw new Error(`The catalog feed named a ${table} row without its key; the catalog feed always names ${table === 'problem_catalog' ? 'id' : 'problem_id'}`)
    const comparable = [...changes.byKey.values()].some((change) => change.action === 'reread' && change.revision !== null && !change.recreated)
    const local = new Map<string, number | null>(
      comparable ? (await this.store.revisions(this.gateway.accountId, table)).map((row) => [row.key, row.revision]) : []
    )
    const plan = planTableApply(changes, local)
    const fetched = plan.lookups.length === 0
      ? []
      : await readIdentityRows(this.client, this.gateway.accountId, table, plan.lookups, IDENTITY_BATCH_LIMITS)
    this.guardRunning()
    const found = new Map(fetched.map((row) => [rowKey(table, row), row] as const))
    const removals = [...plan.removals, ...plan.lookups.filter((change) => !found.has(change.key)).map((change) => change.key)]
    if (removals.length > 0) {
      await this.store.deleteRows(this.gateway.accountId, table, removals)
      // A deleted problem takes its evidence and statement with it, whether or not the feed also names the statement.
      if (table === 'problem_catalog') {
        await this.store.deleteRows(this.gateway.accountId, CATALOG_DETAIL_TABLE, removals)
        await this.store.deleteRows(this.gateway.accountId, 'problem_catalog_content', removals)
      }
    }
    if (found.size === 0) return
    this.guardRunning()
    if (table === 'problem_catalog_content') {
      await this.store.upsertRows(this.gateway.accountId, table, [...found].map(([key, row]) => ({ key, data: row, revision: rowRevisionOf(row) })))
      return
    }
    const { index, details, bare } = catalogParts([...found.values()])
    if (details.length > 0) await this.store.upsertRows(this.gateway.accountId, CATALOG_DETAIL_TABLE, details)
    if (bare.length > 0) await this.store.deleteRows(this.gateway.accountId, CATALOG_DETAIL_TABLE, bare)
    await this.store.upsertRows(this.gateway.accountId, table, index)
  }

  /** Tells pages the catalog changed, naming the rows when it can, as the account pull does. */
  private announce(changes: readonly WorkspaceRowChange[]): void {
    window.dispatchEvent(new CustomEvent('manor:committed', { detail: { operation: 'remote_change', changes } }))
  }
}
