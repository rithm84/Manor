import { afterEach, describe, expect, it } from 'vitest'

import type { HabitSeed } from '../shared/habits'
import { metricsForHabit, statusOn } from '../shared/habits'
import { HabitStore } from './habitStore'

const CREATED_AT = '2026-08-18T08:00:00.000Z'

const SEED: HabitSeed = {
  today: '2026-08-20',
  habits: [
    {
      id: 'habit-a',
      name: 'Water',
      kind: 'quantized',
      targetLabel: '48 oz',
      createdOn: '2026-08-18',
      createdAt: CREATED_AT
    },
    {
      id: 'habit-b',
      name: 'Read',
      kind: 'binary',
      targetLabel: null,
      createdOn: '2026-08-18',
      createdAt: CREATED_AT
    }
  ],
  lifecycle: [
    { habitId: 'habit-a', date: '2026-08-18', status: 'active', createdAt: CREATED_AT },
    { habitId: 'habit-b', date: '2026-08-18', status: 'active', createdAt: CREATED_AT }
  ],
  entries: [
    {
      habitId: 'habit-a',
      date: '2026-08-18',
      value: 50,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    },
    {
      habitId: 'habit-a',
      date: '2026-08-19',
      value: 100,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    },
    {
      habitId: 'habit-a',
      date: '2026-08-20',
      value: 50,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    },
    {
      habitId: 'habit-b',
      date: '2026-08-19',
      value: 100,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    }
  ],
  freezes: [],
  grants: [{ date: '2026-08-18' }, { date: '2026-08-19' }],
  finalizedDays: ['2026-08-19'],
  monthCapacities: { '2026-08': 2 }
}

let store: HabitStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

describe('HabitStore', () => {
  it('applies a shared freeze when yesterday is changed from complete to missed', () => {
    store = new HabitStore(':memory:')
    store.load(SEED)

    const state = store.setEntry(
      { habitId: 'habit-a', date: '2026-08-19', value: 0 },
      '2026-08-20T12:00:00.000Z'
    )

    expect(state.freezes).toContainEqual({ habitId: 'habit-a', date: '2026-08-19' })
    expect(state.pools[0]).toMatchObject({ capacity: 2, earned: 1, spent: 1, balance: 0 })
  })

  it('keeps historical percentages when a quantized habit becomes binary', () => {
    store = new HabitStore(':memory:')
    store.load(SEED)

    const state = store.updateHabit(
      'habit-a',
      { name: 'Water', kind: 'binary', targetLabel: null },
      '2026-08-20T12:00:00.000Z'
    )

    expect(state.entries).toContainEqual(
      expect.objectContaining({ habitId: 'habit-a', date: '2026-08-18', value: 50 })
    )
    expect(state.entries).not.toContainEqual(
      expect.objectContaining({ habitId: 'habit-a', date: '2026-08-20' })
    )
  })

  it('preserves history on pause and rejects destructive deletion of older habits', () => {
    store = new HabitStore(':memory:')
    const initial = store.load(SEED)
    const habit = initial.habits[1]
    if (habit === undefined) {
      throw new Error('Test seed is missing habit-b')
    }

    const paused = store.setStatus(
      { habitId: habit.id, date: SEED.today, status: 'paused' },
      '2026-08-20T12:00:00.000Z'
    )
    expect(statusOn(habit.id, SEED.today, paused.lifecycle)).toBe('paused')
    expect(paused.entries.some((entry) => entry.habitId === habit.id)).toBe(true)
    expect(metricsForHabit(paused, habit).trackedDays).toBeLessThan(
      metricsForHabit(initial, habit).trackedDays
    )
    expect(() => store?.deleteHabit(habit.id)).toThrow(/only a habit created today with no entries/)
  })

  it('purges entries and freeze usage when a habit is retired', () => {
    store = new HabitStore(':memory:')
    store.load(SEED)
    const frozen = store.setEntry(
      { habitId: 'habit-a', date: '2026-08-19', value: 0 },
      '2026-08-20T12:00:00.000Z'
    )
    expect(frozen.freezes.some((freeze) => freeze.habitId === 'habit-a')).toBe(true)

    const retired = store.setStatus(
      { habitId: 'habit-a', date: SEED.today, status: 'retired' },
      '2026-08-20T12:01:00.000Z'
    )

    expect(statusOn('habit-a', SEED.today, retired.lifecycle)).toBe('retired')
    expect(retired.entries.some((entry) => entry.habitId === 'habit-a')).toBe(false)
    expect(retired.freezes.some((freeze) => freeze.habitId === 'habit-a')).toBe(false)
  })

  it('rejects backfill older than one day', () => {
    store = new HabitStore(':memory:')
    store.load(SEED)
    expect(() =>
      store?.setEntry(
        { habitId: 'habit-a', date: '2026-08-18', value: 100 },
        '2026-08-20T12:00:00.000Z'
      )
    ).toThrow(/only be changed/)
  })
})
