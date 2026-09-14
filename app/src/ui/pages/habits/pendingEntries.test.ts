import { describe, expect, it } from 'vitest'

import type { HabitsState } from '../../../shared/habits'
import { overlayPendingEntries, pendingEntryKey } from './pendingEntries'
import type { PendingEntry } from './pendingEntries'

const TODAY = '2026-09-14'
const YESTERDAY = '2026-09-13'

function stateWithReadAt(value: number): HabitsState {
  return {
    today: TODAY,
    habits: [
      {
        id: 'read',
        name: 'Read',
        kind: 'binary',
        targetLabel: null,
        createdOn: '2026-08-01',
        createdAt: '2026-08-01T08:00:00.000Z'
      }
    ],
    lifecycle: [{ habitId: 'read', date: '2026-08-01', status: 'active', createdAt: '2026-08-01T08:00:00.000Z' }],
    entries: [
      {
        habitId: 'read',
        date: TODAY,
        value,
        createdAt: `${TODAY}T20:00:00.000Z`,
        updatedAt: `${TODAY}T20:00:00.000Z`
      }
    ],
    intents: [],
    freezes: [],
    grants: [],
    pools: []
  }
}

function pending(value: number, date: string): ReadonlyMap<string, PendingEntry> {
  return new Map([[pendingEntryKey('read', date), { sequence: 2, habitId: 'read', date, value, stamp: `${TODAY}T21:00:00.000Z` }]])
}

describe('overlayPendingEntries', () => {
  it('returns the state untouched when nothing is in flight', () => {
    const state = stateWithReadAt(100)
    expect(overlayPendingEntries(state, new Map())).toBe(state)
  })

  it('replaces a server entry with the value the click asked for', () => {
    const overlaid = overlayPendingEntries(stateWithReadAt(100), pending(50, TODAY))
    expect(overlaid.entries).toEqual([
      {
        habitId: 'read',
        date: TODAY,
        value: 50,
        createdAt: `${TODAY}T21:00:00.000Z`,
        updatedAt: `${TODAY}T21:00:00.000Z`
      }
    ])
  })

  it('removes a server entry when the click cleared the box', () => {
    expect(overlayPendingEntries(stateWithReadAt(100), pending(0, TODAY)).entries).toEqual([])
  })

  it('keeps a click on another day while the page shows today', () => {
    const overlaid = overlayPendingEntries(stateWithReadAt(100), pending(100, YESTERDAY))
    expect(overlaid.entries.map((entry) => [entry.date, entry.value])).toEqual([[TODAY, 100], [YESTERDAY, 100]])
  })
})
