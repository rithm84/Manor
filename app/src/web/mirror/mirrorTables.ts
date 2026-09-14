import type { JsonObject, JsonValue, ManorTable, RowFilter } from '../ManorGateway'

/**
 * The tables the local mirror holds. Notes keep their draft store and merge layer, files and task series
 * are reached through functions or storage, and the legacy habit tables are never read by a page, so none
 * of them are mirrored. Everything listed here is read straight from SQLite once the mirror is ready.
 */
export const MIRROR_TABLES = [
  'profiles', 'contexts', 'tasks', 'scratch_blocks', 'saved_task_views',
  'habits', 'habit_entries', 'mood_focus_entries',
  'leetcode_attempts', 'leetcode_notes', 'leetcode_problems',
  'job_roles', 'job_stage_transitions', 'job_listings',
  'kb_entries', 'resumes', 'weekly_reviews',
  'calendar_accounts', 'calendars', 'calendar_events'
] as const
export type MirrorTable = (typeof MIRROR_TABLES)[number]

/**
 * How a row is named inside one account. The change feed reports the same fields in `object_key` and a
 * re-read asks Postgres for exactly these columns, so one map drives storage, feed lookups, and re-reads.
 */
const KEY_COLUMNS: Record<MirrorTable, readonly string[]> = {
  profiles: ['user_id'], contexts: ['id'], tasks: ['id'], scratch_blocks: ['id'], saved_task_views: ['id'],
  habits: ['id'], habit_entries: ['habit_id', 'date'], mood_focus_entries: ['date'],
  leetcode_attempts: ['id'], leetcode_notes: ['id'], leetcode_problems: ['id'],
  job_roles: ['id'], job_stage_transitions: ['id'], job_listings: ['id'],
  kb_entries: ['id'], resumes: ['id'], weekly_reviews: ['id'],
  calendar_accounts: ['id'], calendars: ['account_id', 'id'], calendar_events: ['account_id', 'calendar_id', 'id']
}

/**
 * The rows a mirrored table holds whatever a page asks for. `job_listings` is the shared board, and the
 * account only ever reads the open postings, so the copy carries those and nothing else.
 */
const STANDING_FILTERS: Partial<Record<MirrorTable, readonly RowFilter[]>> = {
  job_listings: [{ column: 'active', value: true }]
}

const NO_FILTERS: readonly RowFilter[] = []

/** No change-feed trigger covers these, so the mirror replaces them in full on launch and every hour. */
export const HOURLY_TABLES: readonly MirrorTable[] = ['leetcode_problems', 'job_listings']

/** No trigger either, but it only changes alongside `job_roles`, so a `job_roles` change re-pulls it. */
export const JOB_ROLE_DEPENDENTS: readonly MirrorTable[] = ['job_stage_transitions']

/** Feed-less tables, replaced in full whenever the app launches against a mirror that is already built. */
export const LAUNCH_REFRESH_TABLES: readonly MirrorTable[] = [...HOURLY_TABLES, ...JOB_ROLE_DEPENDENTS]

/** Key columns hold ids, dates, and months, never this control character, so a join on it cannot collide. */
const KEY_SEPARATOR = '\u001f'

export function isMirrored(table: ManorTable): table is MirrorTable {
  return (MIRROR_TABLES as readonly string[]).includes(table)
}

/** The mirrored table a feed row belongs to, or null for an `object_type` the mirror ignores. */
export function mirroredTable(objectType: string): MirrorTable | null {
  return (MIRROR_TABLES as readonly string[]).includes(objectType) ? (objectType as MirrorTable) : null
}

export function keyColumnsOf(table: MirrorTable): readonly string[] {
  return KEY_COLUMNS[table]
}

/** The filters a full pull carries, so the copy holds exactly the rows the table's reads may see. */
export function standingFilters(table: MirrorTable): readonly RowFilter[] {
  return STANDING_FILTERS[table] ?? NO_FILTERS
}

function keyPart(table: MirrorTable, column: string, value: JsonValue | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new TypeError(`${table}.${column} identifies a row, so it holds text or a number, not ${JSON.stringify(value ?? null)}`)
}

/** The stored key of a row read from Postgres. A missing key column is schema drift, so it throws. */
export function rowKey(table: MirrorTable, row: JsonObject): string {
  return KEY_COLUMNS[table].map((column) => keyPart(table, column, row[column])).join(KEY_SEPARATOR)
}

/** The identity a re-read filters on, or null when the feed's `object_key` does not name every key column. */
export function identityFromObjectKey(table: MirrorTable, objectKey: Readonly<Record<string, JsonValue>>): ReadonlyMap<string, string> | null {
  const identity = new Map<string, string>()
  for (const column of KEY_COLUMNS[table]) {
    const value = objectKey[column]
    if (value === undefined || value === null) return null
    identity.set(column, keyPart(table, column, value))
  }
  return identity
}

export function keyFromIdentity(table: MirrorTable, identity: ReadonlyMap<string, string>): string {
  return KEY_COLUMNS[table].map((column) => {
    const value = identity.get(column)
    if (value === undefined) throw new Error(`A ${table} identity is missing ${column}`)
    return value
  }).join(KEY_SEPARATOR)
}

/** The revision a row carries, or null for tables without a revision column (calendar rows, job listings). */
export function rowRevisionOf(row: JsonObject): number | null {
  const value = row.revision
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * Whether a mirror found on disk must be rebuilt instead of pulled. A stored cursor past the account's head
 * belongs to a different history (the account was rebuilt, or the file was carried over from another
 * machine); the feed answers such a cursor with zero rows, so pulling would leave the copy frozen forever.
 */
export function needsRebuild(stored: { ready: boolean; cursor: number }, headCursor: number): boolean {
  return !stored.ready || stored.cursor > headCursor
}
