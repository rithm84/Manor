import { describe, expect, it } from 'vitest'

import { identityBatches, IDENTITY_BATCH_LIMITS } from './identityReads'
import { groupFeedChanges, planTableApply, type FeedChange, type KeyedChange } from './pullPlan'
import type { MirrorTable } from './mirrorTables'

function lookups(table: MirrorTable, keys: readonly Record<string, string>[]): readonly KeyedChange[] {
  const changes: FeedChange[] = keys.map((objectKey, index) => ({
    cursor: index + 1, objectType: table, objectKey, change: 'update', revision: null
  }))
  const grouped = groupFeedChanges(changes, 0).tables.get(table)
  if (grouped === undefined) throw new Error(`${table} is mirrored`)
  return planTableApply(grouped, new Map()).lookups
}

describe('identityBatches', () => {
  it('asks for single-column keys in one filter per batch of rows', () => {
    const batches = identityBatches('tasks', lookups('tasks', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]), { rows: 2, characters: 4_000 })
    expect(batches).toEqual([
      { kind: 'in', column: 'id', values: ['a', 'b'] },
      { kind: 'in', column: 'id', values: ['c'] }
    ])
  })

  it('asks for composite keys as one chain per row', () => {
    const batches = identityBatches('habit_entries', lookups('habit_entries', [
      { habit_id: 'habit-1', date: '2026-09-14' },
      { habit_id: 'habit-2', date: '2026-09-15' }
    ]), IDENTITY_BATCH_LIMITS)
    expect(batches).toEqual([{
      kind: 'or',
      expression: 'and(habit_id.eq."habit-1",date.eq."2026-09-14"),and(habit_id.eq."habit-2",date.eq."2026-09-15")'
    }])
  })

  it('quotes identities that hold characters the filter grammar reserves', () => {
    const batches = identityBatches('calendar_events', lookups('calendar_events', [
      { account_id: 'account-1', calendar_id: 'en.usa#holiday@group.v.calendar.google.com', id: 'event,1' }
    ]), IDENTITY_BATCH_LIMITS)
    expect(batches[0]).toEqual({
      kind: 'or',
      expression: 'and(account_id.eq."account-1",calendar_id.eq."en.usa#holiday@group.v.calendar.google.com",id.eq."event,1")'
    })
  })

  it('splits an or expression by its rendered length, not by a row count', () => {
    // A real calendar event carries a base64 identifier and a Google calendar address, so a hundred of them
    // render far past any URL a proxy accepts; the cap counts characters because the rows are not uniform.
    const rows = Array.from({ length: 60 }, (_, index) => ({
      account_id: '0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa',
      calendar_id: 'en.usa#holiday@group.v.calendar.google.com',
      id: `_6tk3ecpm6ss3ab9m64rj4b9k6or3ab9pcgs3cb9h8gr30c1g60s30c1g60o30c1g${String(index).padStart(4, '0')}`
    }))
    const batches = identityBatches('calendar_events', lookups('calendar_events', rows), IDENTITY_BATCH_LIMITS)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      if (batch.kind !== 'or') throw new Error('a composite key renders as an or expression')
      expect(batch.expression.length).toBeLessThanOrEqual(IDENTITY_BATCH_LIMITS.characters)
    }
    const chains = batches.flatMap((batch) => batch.kind === 'or' ? batch.expression.split('),and(') : [])
    expect(chains).toHaveLength(rows.length)
  })

  it('sends a chain longer than the cap on its own, because nothing shorter names that row', () => {
    const batches = identityBatches('calendar_events', lookups('calendar_events', [
      { account_id: 'a', calendar_id: 'c', id: 'x'.repeat(40) },
      { account_id: 'a', calendar_id: 'c', id: 'y'.repeat(40) }
    ]), { rows: 200, characters: 10 })
    expect(batches).toHaveLength(2)
  })

  it('refuses limits that would send nothing', () => {
    expect(() => identityBatches('tasks', lookups('tasks', [{ id: 'a' }]), { rows: 0, characters: 4_000 })).toThrow(/at least one row/)
    expect(() => identityBatches('tasks', lookups('tasks', [{ id: 'a' }]), { rows: 200, characters: 0 })).toThrow(/at least one character/)
  })
})
