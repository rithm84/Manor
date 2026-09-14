import { describe, expect, it } from 'vitest'

import { identityFromObjectKey, keyFromIdentity, type MirrorTable } from './mirrorTables'
import { groupFeedChanges, planTableApply, type FeedChange } from './pullPlan'

function change(cursor: number, objectType: string, objectKey: Record<string, string | number>, kind: FeedChange['change'], revision: number | null): FeedChange {
  return { cursor, objectType, objectKey, change: kind, revision }
}

function storedKey(table: MirrorTable, objectKey: Record<string, string | number>): string {
  const identity = identityFromObjectKey(table, objectKey)
  if (identity === null) throw new Error(`${table} is keyed by the fields this test supplies`)
  return keyFromIdentity(table, identity)
}

const taskKey = (id: string): string => storedKey('tasks', { id })

describe('groupFeedChanges', () => {
  it('keeps the last change for a row and reports the batch cursor', () => {
    const batch = groupFeedChanges([
      change(4, 'tasks', { id: 'task-1' }, 'insert', 1),
      change(5, 'tasks', { id: 'task-1' }, 'update', 2),
      change(6, 'tasks', { id: 'task-2' }, 'insert', 1),
      change(7, 'tasks', { id: 'task-2' }, 'delete', null)
    ], 3)
    const tasks = batch.tables.get('tasks')
    expect(batch.lastCursor).toBe(7)
    expect(tasks?.byKey.get(taskKey('task-1'))).toMatchObject({ action: 'reread', revision: 2, recreated: false })
    expect(tasks?.byKey.get(taskKey('task-2'))?.action).toBe('remove')
  })

  it('re-reads a row that was deleted and recreated within one batch', () => {
    const batch = groupFeedChanges([
      change(1, 'tasks', { id: 'task-1' }, 'delete', null),
      change(2, 'tasks', { id: 'task-1' }, 'insert', 1)
    ], 0)
    expect(batch.tables.get('tasks')?.byKey.get(taskKey('task-1'))).toMatchObject({ action: 'reread', recreated: true })
  })

  it('remembers the recreation through the updates that follow it', () => {
    const batch = groupFeedChanges([
      change(1, 'habit_entries', { habit_id: 'habit-1', date: '2026-09-14' }, 'delete', null),
      change(2, 'habit_entries', { habit_id: 'habit-1', date: '2026-09-14' }, 'insert', 1),
      change(3, 'habit_entries', { habit_id: 'habit-1', date: '2026-09-14' }, 'update', 2)
    ], 0)
    const key = storedKey('habit_entries', { habit_id: 'habit-1', date: '2026-09-14' })
    expect(batch.tables.get('habit_entries')?.byKey.get(key)).toMatchObject({ revision: 2, recreated: true })
  })

  it('treats a purge as a delete', () => {
    const batch = groupFeedChanges([change(1, 'kb_entries', { id: 'capture-1' }, 'purge', null)], 0)
    expect(batch.tables.get('kb_entries')?.byKey.get('capture-1')?.action).toBe('remove')
  })

  it('names the tables the mirror does not hold, and still advances the cursor', () => {
    const batch = groupFeedChanges([
      change(9, 'note_versions', { note_id: 'note-1', revision: 3 }, 'insert', 3),
      change(10, 'purge_tombstones', { object_type: 'note', object_id: 'note-1' }, 'purge', null)
    ], 8)
    expect(batch.tables.size).toBe(0)
    expect([...batch.ignored]).toEqual(['note_versions', 'purge_tombstones'])
    expect(batch.lastCursor).toBe(10)
  })

  it('asks for a full refresh when the feed cannot name the row', () => {
    const batch = groupFeedChanges([change(2, 'profiles', { revision: 5 }, 'update', 5)], 1)
    expect(batch.tables.get('profiles')).toMatchObject({ fullRefresh: true })
    expect(batch.tables.get('profiles')?.byKey.size).toBe(0)
  })

  it('refuses a feed that does not ascend', () => {
    expect(() => groupFeedChanges([change(4, 'tasks', { id: 'task-1' }, 'insert', 1)], 4)).toThrow(/ascend/)
  })
})

describe('planTableApply', () => {
  const batch = groupFeedChanges([
    change(1, 'tasks', { id: 'fresh' }, 'update', 5),
    change(2, 'tasks', { id: 'already-applied' }, 'update', 3),
    change(3, 'tasks', { id: 'gone' }, 'delete', null)
  ], 0)
  const tasks = batch.tables.get('tasks')

  it('skips a row the local copy already holds at that revision', () => {
    if (tasks === undefined) throw new Error('tasks changed in this batch')
    const plan = planTableApply(tasks, new Map([[taskKey('fresh'), 4], [taskKey('already-applied'), 3]]))
    expect(plan.lookups.map((lookup) => lookup.key)).toEqual([taskKey('fresh')])
    expect(plan.removals).toEqual([taskKey('gone')])
  })

  it('re-reads everything when the local copy has no revisions to compare', () => {
    if (tasks === undefined) throw new Error('tasks changed in this batch')
    const plan = planTableApply(tasks, new Map())
    expect(plan.lookups.map((lookup) => lookup.key)).toEqual([taskKey('fresh'), taskKey('already-applied')])
  })

  it('re-reads a table without revisions on every change', () => {
    const events = groupFeedChanges([change(1, 'calendar_events', { account_id: 'a', calendar_id: 'c', id: 'e' }, 'update', null)], 0)
      .tables.get('calendar_events')
    if (events === undefined) throw new Error('calendar_events changed in this batch')
    expect(planTableApply(events, new Map([['ace', 9]])).lookups).toHaveLength(1)
  })

  it('re-reads a recreated natural-key row even when the local revision is higher', () => {
    // Clearing a habit entry and logging it again recreates the row with `revision` restarting at 1, so a
    // local revision above the feed's belongs to the row that was deleted, not to the one that replaced it.
    const key = storedKey('habit_entries', { habit_id: 'habit-1', date: '2026-09-14' })
    const entries = groupFeedChanges([
      change(1, 'habit_entries', { habit_id: 'habit-1', date: '2026-09-14' }, 'delete', null),
      change(2, 'habit_entries', { habit_id: 'habit-1', date: '2026-09-14' }, 'insert', 1)
    ], 0).tables.get('habit_entries')
    if (entries === undefined) throw new Error('habit_entries changed in this batch')
    const plan = planTableApply(entries, new Map([[key, 7]]))
    expect(plan.lookups.map((lookup) => lookup.key)).toEqual([key])
    expect(plan.removals).toEqual([])
  })
})
