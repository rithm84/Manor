import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { tableOrder, affectedTables, readColumns } from './gatewayQueries'
import { selectMirrorRows } from './mirror/mirrorRows'
import { isMirrored } from './mirror/mirrorTables'
import type { DerivedName } from './mirror/MirrorStore'
import type { MirrorSync } from './mirror/MirrorSync'

export const TABLES = ['profiles', 'tasks', 'contexts', 'scratch_blocks', 'saved_task_views',
  'habits', 'habit_lifecycle', 'habit_entries', 'habit_freeze_intents', 'habit_freeze_usage', 'habit_freeze_grants', 'habit_month_pools',
  'mood_focus_entries', 'pomodoro_sessions', 'note_folders', 'note_pages', 'note_attachments', 'note_versions', 'note_suggestions',
  'job_roles', 'job_stage_transitions', 'job_listings', 'leetcode_problems', 'leetcode_attempts', 'leetcode_notes',
  'kb_entries', 'resumes', 'weekly_reviews', 'action_events', 'calendar_accounts', 'calendars', 'calendar_events'] as const
export type ManorTable = typeof TABLES[number]
/** Whether a name is one of the tables the gateway caches reads for, which is what a change feed row names. */
export function isManorTable(name: string): name is ManorTable {
  return (TABLES as readonly string[]).includes(name)
}
export type JsonValue = z.infer<ReturnType<typeof z.json>>
export type JsonObject = { [key: string]: JsonValue }
/** One equality filter of a read. Pages express every filtered read this way, on both read paths. */
export interface RowFilter { readonly column: string; readonly value: string | number | boolean }
export const rowSchema = z.record(z.string(), z.json())
const receiptSchema = z.object({
  command_id: z.uuid(), operation: z.string(), replayed: z.boolean(),
  record: rowSchema.nullable().optional(), records: z.array(rowSchema).optional()
})
export type CommandResult = z.infer<typeof receiptSchema>

export class ManorRequestError extends Error {
  readonly code: string
  constructor(operation: string, code: string, detail: string) {
    super(`${operation}: ${detail}`)
    this.name = 'ManorRequestError'
    this.code = code
  }
}

export class ManorConnectionError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation}: Manor could not reach the server. ${detail}`)
    this.name = 'ManorConnectionError'
  }
}

/** Account-bound transport. Domain adapters validate each row's specific schema. */
export class ManorGateway {
  readonly client: SupabaseClient
  readonly accountId: string
  private readonly queries: QueryClient
  private readonly snapshots = new Map<ManorTable, readonly JsonObject[]>()
  private mirror: MirrorSync | null = null

  constructor(client: SupabaseClient, queries: QueryClient, accountId: string) {
    this.client = client
    this.queries = queries
    this.accountId = accountId
  }

  /** Points reads at the local mirror. Until one is attached and ready, every read goes to the server. */
  attachMirror(sync: MirrorSync | null): void {
    this.mirror = sync
  }

  /**
   * Stops the mirror and returns reads to the server. Sign-out calls this before it wipes the file, so no
   * read and no pull is still in flight against a store that is about to be deleted.
   */
  stopMirror(): void {
    this.mirror?.stop()
    this.mirror = null
  }

  /** Share one in-flight or fresh read between a route prefetch and the page that later asks for it. */
  cached<T>(key: readonly (string | number)[], load: () => Promise<T>): Promise<T> {
    return this.queries.fetchQuery({ queryKey: ['manor', this.accountId, ...key], queryFn: load })
  }

  async rows(table: ManorTable): Promise<JsonObject[]> {
    return this.readRows(table, [])
  }

  async rowsWhere(table: ManorTable, filters: readonly RowFilter[]): Promise<JsonObject[]> {
    if (filters.length === 0) throw new Error('Filtered queries require at least one equality filter')
    return this.readRows(table, filters)
  }

  /** The mirrored rows of a table, or null when this read belongs on the server. */
  async mirroredRows(table: ManorTable): Promise<JsonObject[] | null> {
    return this.mirror === null || !isMirrored(table) ? null : this.mirror.mirroredRows(table)
  }

  /**
   * The owner-scoped read straight from Postgres, paginated. Reads take this path for tables the mirror
   * does not hold and while it is still filling, and the mirror's own bootstrap fills itself with it.
   */
  async readRowsFromServer(table: ManorTable, filters: readonly RowFilter[]): Promise<JsonObject[]> {
    const all: JsonObject[] = []
    for (let offset = 0; offset < 100_000; offset += 1000) {
      let query = this.client.from(table).select(readColumns(table)).range(offset, offset + 999)
      if (table !== 'job_listings') query = query.eq('user_id', this.accountId)
      for (const column of tableOrder[table]) query = query.order(column, { ascending: true })
      for (const filter of filters) query = query.eq(filter.column, filter.value)
      const { data, error, status } = await query
      if (error && status === 0) {
        window.dispatchEvent(new CustomEvent('manor:connection', { detail: { connected: false } }))
        throw new ManorConnectionError(`Read ${table}`, error.message)
      }
      if (error) throw new ManorRequestError(`Read ${table}`, error.code, error.message)
      window.dispatchEvent(new CustomEvent('manor:connection', { detail: { connected: true } }))
      const page = z.array(rowSchema).parse(data)
      all.push(...page)
      if (page.length < 1000) return all
    }
    throw new RangeError(`Read ${table}: use a filtered query for more than 100,000 records`)
  }

  private async readRows(table: ManorTable, filters: readonly RowFilter[]): Promise<JsonObject[]> {
    const rows = await this.queries.fetchQuery({
      queryKey: ['manor', this.accountId, table, filters],
      queryFn: async () => {
        const mirrored = await this.mirroredRows(table)
        return mirrored === null ? this.readRowsFromServer(table, filters) : selectMirrorRows(table, mirrored, filters)
      }
    })
    if (filters.length === 0) this.snapshots.set(table, rows)
    else {
      const key = (row: JsonObject): string => JSON.stringify(tableOrder[table].map(column => row[column]))
      const merged = new Map((this.snapshots.get(table) ?? []).map(row => [key(row), row]))
      for (const row of rows) merged.set(key(row), row)
      this.snapshots.set(table, [...merged.values()])
    }
    return rows
  }

  revision(table: ManorTable, id: string): number {
    const rows = this.snapshots.get(table)
    if (!rows) throw new Error(`Load ${table} before changing ${id}`)
    const row = rows.find(candidate => candidate.id === id)
    if (!row) throw new Error(`${table} record ${id} is no longer available`)
    return z.number().int().nonnegative().parse(row.revision)
  }

  /** Commands this tab issued; their own realtime echoes carry nothing the local refresh did not already apply. */
  private readonly issued = new Set<string>()

  issuedCommand(commandId: string): boolean { return this.issued.has(commandId) }

  async command(operation: string, input: JsonObject, commandId: string): Promise<CommandResult> {
    z.uuid().parse(commandId)
    this.issued.add(commandId)
    if (this.issued.size > 500) this.issued.delete(this.issued.values().next().value as string)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error, status } = await this.client.rpc('manor_command', {
        p_command_id: commandId, p_operation: operation, p_input: input
      })
      if (!error) {
        const receipt = receiptSchema.parse(data)
        if (receipt.command_id !== commandId || receipt.operation !== operation) throw new Error('Command receipt does not match the request')
        // Pulling before the invalidation is what keeps the mirror ahead of the pages that refetch from it.
        // Only while it is serving them: until then the refetch reads the server anyway, and waiting here
        // would park a save behind a bootstrap that is copying every table.
        if (this.mirror !== null && this.mirror.isServing()) await this.mirror.afterCommand()
        await this.invalidateOperation(operation)
        window.dispatchEvent(new CustomEvent('manor:committed', { detail: { operation, commandId } }))
        return receipt
      }
      // A revision conflict is final. A serialization failure (40001) is transient and the command id makes a retry a replay.
      if (attempt === 2 || error.code === 'PT409' || (error.code !== '40001' && status !== 0 && status !== 429 && status < 500)) {
        throw new ManorRequestError(operation, error.code, error.message)
      }
      console.warn('Retrying Manor command', { operation, commandId, status, attempt: attempt + 1 })
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
    }
    throw new Error('Command attempts exhausted')
  }

  async invalidateOperation(operation: string): Promise<void> {
    const tables = affectedTables(operation)
    if (tables === null) { await this.invalidate(); return }
    await Promise.all(tables.map(table => this.queries.invalidateQueries({ queryKey: ['manor', this.accountId, table] })))
  }

  /** Drops the cached reads of the tables a pull changed, and the calendar days assembled from them. */
  async invalidateTables(tables: readonly ManorTable[]): Promise<void> {
    const keys: readonly string[] = [...tables, 'calendar_days']
    await Promise.all(keys.map((key) => this.queries.invalidateQueries({ queryKey: ['manor', this.accountId, key] })))
  }

  /** An account-derived RPC, served from the mirror's cursor-keyed cache whenever a mirror is attached. */
  cachedDerived(name: DerivedName, load: () => Promise<JsonValue>): Promise<JsonValue> {
    return this.mirror === null ? load() : this.mirror.derived(name, load)
  }

  invalidate(): Promise<void> {
    return this.queries.invalidateQueries({ queryKey: ['manor', this.accountId] })
  }

  /**
   * The refresh that follows a write which committed outside `command`, such as the verifier finalizing an
   * upload. The mirror pulls first for the same reason it does after a command: a page that refetches from
   * the mirror must find the row there.
   */
  async afterServerWrite(): Promise<void> {
    if (this.mirror !== null && this.mirror.isServing()) await this.mirror.afterCommand()
    await this.invalidate()
  }
}
