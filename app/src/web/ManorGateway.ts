import type { SupabaseClient } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { tableOrder, affectedTables } from './gatewayQueries'

export const TABLES = ['profiles', 'tasks', 'contexts', 'scratch_blocks', 'saved_task_views',
  'habits', 'habit_lifecycle', 'habit_entries', 'habit_freeze_intents', 'habit_freeze_usage', 'habit_freeze_grants', 'habit_month_pools',
  'mood_focus_entries', 'note_folders', 'note_pages', 'note_attachments', 'note_versions', 'note_suggestions',
  'job_roles', 'job_stage_transitions', 'job_listings', 'leetcode_problems', 'leetcode_attempts', 'leetcode_notes',
  'kb_entries', 'resumes', 'weekly_reviews', 'action_events', 'calendar_accounts', 'calendars', 'calendar_events'] as const
export type ManorTable = typeof TABLES[number]
export type JsonValue = z.infer<ReturnType<typeof z.json>>
export type JsonObject = { [key: string]: JsonValue }
const rowSchema = z.record(z.string(), z.json())
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

  constructor(client: SupabaseClient, queries: QueryClient, accountId: string) {
    this.client = client
    this.queries = queries
    this.accountId = accountId
  }

  /** Share one in-flight or fresh read between a route prefetch and the page that later asks for it. */
  cached<T>(key: readonly (string | number)[], load: () => Promise<T>): Promise<T> {
    return this.queries.fetchQuery({ queryKey: ['manor', this.accountId, ...key], queryFn: load })
  }

  async rows(table: ManorTable): Promise<JsonObject[]> {
    return this.readRows(table, [])
  }

  async rowsWhere(table: ManorTable, filters: readonly { column: string; value: string | number | boolean }[]): Promise<JsonObject[]> {
    if (filters.length === 0) throw new Error('Filtered queries require at least one equality filter')
    return this.readRows(table, filters)
  }

  private async readRows(table: ManorTable, filters: readonly { column: string; value: string | number | boolean }[]): Promise<JsonObject[]> {
    const rows = await this.queries.fetchQuery({
      queryKey: ['manor', this.accountId, table, filters],
      queryFn: async () => {
        const all: JsonObject[] = []
        for (let offset = 0; offset < 100_000; offset += 1000) {
          let query = this.client.from(table).select('*').range(offset, offset + 999)
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

  invalidate(): Promise<void> {
    return this.queries.invalidateQueries({ queryKey: ['manor', this.accountId] })
  }
}
