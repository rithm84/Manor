import type { JsonValue } from '../ManorGateway'
import { identityFromObjectKey, keyFromIdentity, mirroredTable, type MirrorTable } from './mirrorTables'

export type FeedChangeKind = 'insert' | 'update' | 'delete' | 'purge'

/** One row of `manor_workspace_changes`: which row changed and how, never what it now holds. */
export interface FeedChange {
  readonly cursor: number
  readonly objectType: string
  readonly objectKey: Readonly<Record<string, JsonValue>>
  readonly change: FeedChangeKind
  readonly revision: number | null
}

/** What one row needs after every change in a batch is folded together, in cursor order. */
export interface KeyedChange {
  readonly key: string
  readonly action: 'remove' | 'reread'
  readonly identity: ReadonlyMap<string, string>
  readonly revision: number | null
  /**
   * A remove for this key came earlier in the same batch. Rows keyed by their natural identity are
   * recreated with `revision` restarting at 1 (clearing a habit entry and logging it again), so a local
   * revision above the feed's says nothing about such a row and its re-read can never be skipped.
   */
  readonly recreated: boolean
}

export interface TableChanges {
  /** Set when the feed named a row the table's key columns cannot address, which only a full pull resolves. */
  readonly fullRefresh: boolean
  readonly byKey: ReadonlyMap<string, KeyedChange>
}

export interface FeedBatch {
  readonly tables: ReadonlyMap<MirrorTable, TableChanges>
  readonly lastCursor: number
  /** The object types the mirror does not hold. They still advance the cursor, and pages still cache them. */
  readonly ignored: ReadonlySet<string>
}

/**
 * Folds a page of the feed into per-table work. The feed is contiguous and ascending, so the last change
 * for a key decides its fate: an insert followed by a delete is a delete, and a delete followed by an
 * insert is a re-read of a recreated row. A cursor that does not ascend means the feed contract broke.
 */
export function groupFeedChanges(changes: readonly FeedChange[], since: number): FeedBatch {
  const tables = new Map<MirrorTable, { fullRefresh: boolean; byKey: Map<string, KeyedChange> }>()
  const ignored = new Set<string>()
  let lastCursor = since
  for (const change of changes) {
    if (change.cursor <= lastCursor) throw new RangeError(`The change feed returned cursor ${change.cursor} after ${lastCursor}; cursors ascend`)
    lastCursor = change.cursor
    const table = mirroredTable(change.objectType)
    if (table === null) { ignored.add(change.objectType); continue }
    const entry = tables.get(table) ?? { fullRefresh: false, byKey: new Map<string, KeyedChange>() }
    tables.set(table, entry)
    const identity = identityFromObjectKey(table, change.objectKey)
    if (identity === null) { entry.fullRefresh = true; continue }
    const key = keyFromIdentity(table, identity)
    const previous = entry.byKey.get(key)
    const action = change.change === 'delete' || change.change === 'purge' ? 'remove' : 'reread'
    const recreated = action === 'reread' && previous !== undefined && (previous.action === 'remove' || previous.recreated)
    entry.byKey.set(key, { key, action, identity, revision: change.revision, recreated })
  }
  return { tables, lastCursor, ignored }
}

export interface TableApplyPlan {
  readonly removals: readonly string[]
  readonly lookups: readonly KeyedChange[]
}

/**
 * Splits a table's folded changes into deletions and re-reads. A local row already at or past the feed's
 * revision came from this app's own command, so its re-read is skipped; a table without a revision column
 * reports null and is always re-read, and so is a row this batch deleted before recreating it.
 */
export function planTableApply(changes: TableChanges, localRevisions: ReadonlyMap<string, number | null>): TableApplyPlan {
  const removals: string[] = []
  const lookups: KeyedChange[] = []
  for (const change of changes.byKey.values()) {
    if (change.action === 'remove') { removals.push(change.key); continue }
    const local = localRevisions.get(change.key) ?? null
    if (!change.recreated && change.revision !== null && local !== null && local >= change.revision) continue
    lookups.push(change)
  }
  return { removals, lookups }
}
