import { describe, expect, it } from 'vitest'

import { identityFromObjectKey, keyFromIdentity, needsRebuild, rowKey, rowRevisionOf, standingFilters } from './mirrorTables'

describe('mirror row keys', () => {
  it('joins composite keys in column order', () => {
    const event = { account_id: 'account-1', calendar_id: 'calendar-1', id: 'event-1', title: 'Standup' }
    expect(rowKey('calendar_events', event)).toBe(rowKey('calendar_events', { ...event, title: 'Renamed' }))
    expect(rowKey('calendar_events', event)).not.toBe(rowKey('calendar_events', { ...event, calendar_id: 'calendar-2' }))
  })

  it('reads the key the change feed reports, whatever else it carries', () => {
    const identity = identityFromObjectKey('habit_entries', { habit_id: 'habit-1', date: '2026-09-14', revision: 4 })
    if (identity === null) throw new Error('the feed names both habit_entries key columns')
    expect(keyFromIdentity('habit_entries', identity)).toBe(rowKey('habit_entries', { habit_id: 'habit-1', date: '2026-09-14', value: 1 }))
  })

  it('refuses a row whose key column is missing, because that is schema drift', () => {
    expect(() => rowKey('tasks', { title: 'No identity' })).toThrow(/tasks.id/)
  })

  it('returns null when the feed does not name every key column', () => {
    // The feed reports identity fields by name, and profiles are keyed by a user_id it never includes.
    expect(identityFromObjectKey('profiles', { revision: 7 })).toBeNull()
    expect(identityFromObjectKey('calendars', { id: 'calendar-1' })).toBeNull()
  })

  it('reports a revision only for tables that carry one', () => {
    expect(rowRevisionOf({ id: 'task-1', revision: 3 })).toBe(3)
    expect(rowRevisionOf({ id: 'event-1' })).toBeNull()
  })
})

describe('standingFilters', () => {
  it('mirrors only the open postings of the shared board', () => {
    expect(standingFilters('job_listings')).toEqual([{ column: 'active', value: true }])
  })

  it('mirrors an owner-scoped table whole', () => {
    expect(standingFilters('tasks')).toEqual([])
    expect(standingFilters('leetcode_problems')).toEqual([])
  })
})

describe('needsRebuild', () => {
  it('rebuilds a mirror that was never filled', () => {
    expect(needsRebuild({ ready: false, cursor: 0 }, 0)).toBe(true)
    expect(needsRebuild({ ready: false, cursor: 12 }, 40)).toBe(true)
  })

  it('pulls a mirror that is behind the account head', () => {
    expect(needsRebuild({ ready: true, cursor: 12 }, 40)).toBe(false)
    expect(needsRebuild({ ready: true, cursor: 40 }, 40)).toBe(false)
  })

  it('rebuilds a copy from a history the account no longer has', () => {
    // The feed answers a cursor past the head with no rows, so pulling such a copy would never update it.
    expect(needsRebuild({ ready: true, cursor: 41 }, 40)).toBe(true)
    expect(needsRebuild({ ready: true, cursor: 900 }, 0)).toBe(true)
  })
})
