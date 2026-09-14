import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { ManorConnectionError, ManorRequestError } from '../ManorGateway'
import type { FeedChange } from './pullPlan'

/** PostgREST renders a bigint as a JSON number, and as a string once it leaves the safe integer range. */
const cursorSchema = z.union([z.number().int(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative())
const nullableCursorSchema = z.union([z.number().int(), z.string().regex(/^\d+$/), z.null()]).transform((value) => value === null ? null : Number(value))

const changeSchema = z.object({
  cursor: cursorSchema,
  object_type: z.string().min(1),
  object_key: z.record(z.string(), z.json()),
  change: z.enum(['insert', 'update', 'delete', 'purge']),
  revision: nullableCursorSchema
})

/** The most rows one request asks for. The RPC clamps its own limit to 1000. */
export const FEED_PAGE_SIZE = 1000

/** The account's change feed: what changed and in which order, never what a row now holds. */
export class WorkspaceFeed {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  /** The account's head cursor, and 0 before its first change. */
  async cursor(): Promise<number> {
    const { data, error, status } = await this.client.rpc('manor_workspace_cursor')
    this.report('manor_workspace_cursor', error, status)
    return cursorSchema.parse(data)
  }

  async changes(since: number, limit: number): Promise<FeedChange[]> {
    const { data, error, status } = await this.client.rpc('manor_workspace_changes', { p_since: since, p_limit: limit })
    this.report('manor_workspace_changes', error, status)
    return z.array(changeSchema).parse(data).map((row) => ({
      cursor: row.cursor, objectType: row.object_type, objectKey: row.object_key, change: row.change, revision: row.revision
    }))
  }

  /**
   * The mirror does most of the app's talking to the server now, so its reachability drives the same
   * connection banner the gateway's reads used to drive.
   */
  private report(operation: string, error: { code?: string; message: string } | null, status: number): void {
    if (error && status === 0) {
      window.dispatchEvent(new CustomEvent('manor:connection', { detail: { connected: false } }))
      throw new ManorConnectionError(operation, error.message)
    }
    if (error) throw new ManorRequestError(operation, error.code ?? 'unknown', error.message)
    window.dispatchEvent(new CustomEvent('manor:connection', { detail: { connected: true } }))
  }
}
