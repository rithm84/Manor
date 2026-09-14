import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { ManorConnectionError, ManorRequestError, rowSchema, type JsonObject } from '../ManorGateway'
import { readColumns } from '../gatewayQueries'
import { keyColumnsOf, type MirrorTable } from './mirrorTables'
import type { KeyedChange } from './pullPlan'

/** How large one re-read request may get: a row count for id lists, a rendered length for identity chains. */
export interface IdentityBatchLimits {
  /** Rows in one `in` filter. Ids are short and uniform, so a count bounds the request well enough. */
  readonly rows: number
  /** Characters in one `or` expression. A calendar id alone runs past sixty, so length is what binds. */
  readonly characters: number
}

/** What one re-read asks for. Both caps keep the rendered query well inside what a proxy accepts in a URL. */
export const IDENTITY_BATCH_LIMITS: IdentityBatchLimits = { rows: 200, characters: 4_000 }

export type IdentityBatch =
  | { readonly kind: 'in'; readonly column: string; readonly values: readonly string[] }
  | { readonly kind: 'or'; readonly expression: string }

/** PostgREST reads a quoted value literally; only the quote and the escape itself need escaping inside it. */
function quoted(value: string): string {
  if (/[\u0000-\u001f]/.test(value)) throw new Error(`A row identity holds a control character: ${JSON.stringify(value)}`)
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function identityValue(table: MirrorTable, change: KeyedChange, column: string): string {
  const value = change.identity.get(column)
  if (value === undefined) throw new Error(`A ${table} change is missing ${column}, so its row cannot be re-read`)
  return value
}

/** One row of an `or` expression: every key column of that row, joined into a single equality chain. */
function identityChain(table: MirrorTable, change: KeyedChange, columns: readonly string[]): string {
  return `and(${columns.map((column) => `${column}.eq.${quoted(identityValue(table, change, column))}`).join(',')})`
}

function inBatches(table: MirrorTable, lookups: readonly KeyedChange[], column: string, rows: number): IdentityBatch[] {
  const batches: IdentityBatch[] = []
  for (let offset = 0; offset < lookups.length; offset += rows) {
    batches.push({ kind: 'in', column, values: lookups.slice(offset, offset + rows).map((change) => identityValue(table, change, column)) })
  }
  return batches
}

/**
 * Fills one `or` expression at a time and starts the next one before the current would pass `characters`.
 * A single chain longer than the cap travels on its own, because nothing shorter addresses that row.
 */
function orBatches(table: MirrorTable, lookups: readonly KeyedChange[], columns: readonly string[], characters: number): IdentityBatch[] {
  const batches: IdentityBatch[] = []
  let chains: string[] = []
  let length = 0
  for (const change of lookups) {
    const chain = identityChain(table, change, columns)
    // The comma that joins this chain to the ones before it is part of what the request carries.
    if (chains.length > 0 && length + 1 + chain.length > characters) {
      batches.push({ kind: 'or', expression: chains.join(',') })
      chains = []
      length = 0
    }
    length += chains.length === 0 ? chain.length : 1 + chain.length
    chains.push(chain)
  }
  if (chains.length > 0) batches.push({ kind: 'or', expression: chains.join(',') })
  return batches
}

/**
 * Turns re-reads into as few requests as possible: a single-column key becomes one `in` filter per batch of
 * rows, and a composite key becomes `or` expressions of equality chains, each kept under a length cap.
 */
export function identityBatches(table: MirrorTable, lookups: readonly KeyedChange[], limits: IdentityBatchLimits): IdentityBatch[] {
  if (limits.rows < 1) throw new RangeError('An identity batch holds at least one row')
  if (limits.characters < 1) throw new RangeError('An identity expression holds at least one character')
  const columns = keyColumnsOf(table)
  return columns.length === 1
    ? inBatches(table, lookups, columns[0], limits.rows)
    : orBatches(table, lookups, columns, limits.characters)
}

/**
 * Re-reads the named rows from Postgres. The mirror never trusts a delta, so an insert or update always
 * comes back as the row itself; a row the account can no longer see simply does not come back. Every table
 * the feed covers is owner-scoped, so the owner filter always belongs here: the two shared tables have no
 * feed and are replaced in full instead.
 */
export async function readIdentityRows(
  client: SupabaseClient, accountId: string, table: MirrorTable, lookups: readonly KeyedChange[], limits: IdentityBatchLimits
): Promise<JsonObject[]> {
  const rows: JsonObject[] = []
  for (const batch of identityBatches(table, lookups, limits)) {
    let query = client.from(table).select(readColumns(table)).eq('user_id', accountId)
    query = batch.kind === 'in' ? query.in(batch.column, [...batch.values]) : query.or(batch.expression)
    const { data, error, status } = await query
    if (error && status === 0) throw new ManorConnectionError(`Re-read ${table}`, error.message)
    if (error) throw new ManorRequestError(`Re-read ${table}`, error.code, error.message)
    rows.push(...z.array(rowSchema).parse(data))
  }
  return rows
}
