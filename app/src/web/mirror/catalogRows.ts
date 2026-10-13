import { z } from 'zod'

import { latestCompanyReport } from '../../shared/problemSourceMetadata'
import type { JsonObject, JsonValue } from '../ManorGateway'
import type { MirrorRow } from './MirrorStore'
import { rowKey, rowRevisionOf } from './mirrorTables'

/**
 * How a catalog problem is stored: the index row the library reads, and the source evidence only an open
 * problem shows.
 *
 * Company reports and source snapshots are about two thirds of the catalog's metadata bytes (16.7 MB of the
 * 25.6 MB of staging's 13.2k problem rows), and the library reads every index row on each load. The index row
 * therefore keeps `source_metadata` without them, except for the single latest report, which is the one the
 * library's recency column shows for a problem without an asked date. The full lists live in
 * `problem_catalog_detail` under the problem id and rejoin the row when the problem opens.
 */
export interface CatalogRowParts {
  readonly index: MirrorRow
  /** Null when the problem has no reports or snapshots, so there is nothing to keep apart. */
  readonly detail: MirrorRow | null
}

/** The two evidence lists kept out of the index. */
const DETAIL_FIELDS = ['companyReports', 'snapshots'] as const

/** Enough of a report to pick the latest one; the full report is validated when its problem is read. */
const reportOrderSchema = z.looseObject({ snapshotDate: z.iso.date(), window: z.enum(['30d', '3m', '6m', '1y', 'all', 'older_than_6m']) })

function metadataOf(row: JsonObject): JsonObject | null {
  const metadata = row.source_metadata
  if (metadata === undefined || metadata === null) return null
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError(`Catalog problem ${String(row.id)} has source_metadata that is not an object`)
  return metadata
}

function listOf(metadata: JsonObject, field: (typeof DETAIL_FIELDS)[number], id: string): JsonValue[] | undefined {
  const value = metadata[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError(`Catalog problem ${id} has source_metadata.${field} that is not a list`)
  return value
}

/** Splits a `problem_catalog` row read from Postgres or a snapshot into its stored index row and detail row. */
export function splitCatalogRow(row: JsonObject): CatalogRowParts {
  const key = rowKey('problem_catalog', row)
  const revision = rowRevisionOf(row)
  const metadata = metadataOf(row)
  const reports = metadata === null ? undefined : listOf(metadata, 'companyReports', key)
  const snapshots = metadata === null ? undefined : listOf(metadata, 'snapshots', key)
  if (metadata === null || (reports === undefined && snapshots === undefined)) return { index: { key, data: row, revision }, detail: null }
  const { companyReports: _reports, snapshots: _snapshots, ...rest } = metadata
  const latest = latestCompanyReport((reports ?? []).map((report) => ({ ...reportOrderSchema.parse(report), report })))?.report
  const indexMetadata: JsonObject = latest === undefined ? rest : { ...rest, companyReports: [latest] }
  const detail: JsonObject = { ...(reports === undefined ? {} : { companyReports: reports }), ...(snapshots === undefined ? {} : { snapshots }) }
  return { index: { key, data: { ...row, source_metadata: indexMetadata }, revision }, detail: { key, data: detail, revision } }
}

/**
 * The full `problem_catalog` row: the stored index row with its detail lists put back. An index row that kept
 * a latest report always has a detail row, because a pull writes the detail before the index; one without it
 * means the copy is broken, so this throws rather than present one report as the whole list.
 */
export function joinCatalogDetail(index: JsonObject, detail: JsonObject | null): JsonObject {
  const metadata = metadataOf(index)
  if (detail === null) {
    if (metadata !== null && metadata.companyReports !== undefined) throw new Error(`The local copy of catalog problem ${String(index.id)} lost its company reports; sign out and in again to rebuild it`)
    return index
  }
  const { companyReports: _latest, ...rest } = metadata ?? {}
  const restored: JsonObject = { ...rest }
  for (const field of DETAIL_FIELDS) if (detail[field] !== undefined) restored[field] = detail[field]
  return { ...index, source_metadata: restored }
}
