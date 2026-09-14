import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import type { JsonObject, JsonValue } from '../ManorGateway'
import type { MirrorTable } from './mirrorTables'

/**
 * Stored rows are checked at their envelope rather than field by field. Every one of them was validated
 * against `rowSchema` when it was read from Postgres and has not left this machine since, and a read can
 * return thousands of them, where per-field validation would cost more than the round trip it replaces.
 */
const storedData = z.custom<JsonObject>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'A mirrored row holds the JSON object Postgres returned' }
)

/** A stored row: its account-local key, the row as Postgres returned it, and the revision it carried. */
const mirrorRowSchema = z.object({
  key: z.string().min(1),
  data: storedData,
  revision: z.number().int().nullable()
})
export type MirrorRow = z.infer<typeof mirrorRowSchema>

/** A stored row without its JSON, which is all a pull needs to tell whether a re-read would say anything. */
const mirrorRevisionSchema = z.object({
  key: z.string().min(1),
  revision: z.number().int().nullable()
})
export type MirrorRevision = z.infer<typeof mirrorRevisionSchema>

const mirrorStatusSchema = z.object({
  ready: z.boolean(),
  cursor: z.number().int().nonnegative(),
  rowCounts: z.record(z.string(), z.number().int().nonnegative())
})
export type MirrorStatus = z.infer<typeof mirrorStatusSchema>

const derivedSchema = z.object({
  value: z.json(),
  cursor: z.number().int().nonnegative(),
  day: z.iso.date()
})
export type DerivedValue = z.infer<typeof derivedSchema>

/** The account-derived reads the mirror caches. Both depend only on account data and the current day. */
export type DerivedName = 'manor_habits_state' | 'manor_leetcode_summary'

function failure(command: string, cause: unknown): Error {
  return new Error(`The local mirror refused ${command}: ${cause instanceof Error ? cause.message : String(cause)}`)
}

async function read<T>(command: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  let result: unknown
  try { result = await invoke(command, args) }
  catch (cause: unknown) { throw failure(command, cause) }
  return schema.parse(result)
}

async function write(command: string, args: Record<string, unknown>): Promise<void> {
  try { await invoke(command, args) }
  catch (cause: unknown) { throw failure(command, cause) }
}

/**
 * The SQLite mirror the desktop shell owns. Every call crosses the Tauri boundary, so every result is
 * validated, and every call but the two that ask which mirror is open names the account it means: the
 * shell refuses a call that names anybody else, so a pass left over from a previous sign-in cannot write
 * into the account that replaced it.
 */
export class MirrorStore {
  /** Opens or creates this account's mirror. A schema or account mismatch comes back empty and not ready. */
  open(accountId: string): Promise<MirrorStatus> {
    return read('mirror_open', { accountId }, mirrorStatusSchema)
  }

  status(): Promise<MirrorStatus> {
    return read('mirror_status', {}, mirrorStatusSchema)
  }

  replaceTable(accountId: string, table: MirrorTable, rows: readonly MirrorRow[]): Promise<void> {
    return write('mirror_replace_table', { accountId, table, rows })
  }

  upsertRows(accountId: string, table: MirrorTable, rows: readonly MirrorRow[]): Promise<void> {
    return write('mirror_upsert_rows', { accountId, table, rows })
  }

  deleteRows(accountId: string, table: MirrorTable, keys: readonly string[]): Promise<void> {
    return write('mirror_delete_rows', { accountId, table, keys })
  }

  rows(accountId: string, table: MirrorTable): Promise<MirrorRow[]> {
    return read('mirror_rows', { accountId, table }, z.array(mirrorRowSchema))
  }

  /** The key and revision of every stored row of a table, without the JSON a revision check never reads. */
  revisions(accountId: string, table: MirrorTable): Promise<MirrorRevision[]> {
    return read('mirror_revisions', { accountId, table }, z.array(mirrorRevisionSchema))
  }

  /** Records how far the mirror has caught up. Only a completed apply may move the cursor. */
  commit(accountId: string, cursor: number, ready: boolean): Promise<void> {
    return write('mirror_commit', { accountId, cursor, ready })
  }

  putDerived(accountId: string, name: DerivedName, value: JsonValue, cursor: number, day: string): Promise<void> {
    return write('mirror_put_derived', { accountId, name, value, cursor, day })
  }

  getDerived(accountId: string, name: DerivedName): Promise<DerivedValue | null> {
    return read('mirror_get_derived', { accountId, name }, derivedSchema.nullable())
  }

  /** Drops one cached derived read, which is how a refresh the cursor cannot see invalidates what it feeds. */
  deleteDerived(accountId: string, name: DerivedName): Promise<void> {
    return write('mirror_delete_derived', { accountId, name })
  }

  /** Closes and deletes the file. Sign-out clears local account data, and the mirror is part of it. */
  wipe(accountId: string): Promise<void> {
    return write('mirror_wipe', { accountId })
  }
}
