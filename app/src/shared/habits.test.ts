import { describe, expect, it } from 'vitest'

import type { HabitDefinition, HabitsState } from './habits'
import { metricsForHabit } from './habits'

const HABIT: HabitDefinition = {
  id: 'habit-one',
  name: 'Read',
  kind: 'binary',
  targetLabel: null,
  createdOn: '2026-08-01',
  createdAt: '2026-08-01T08:00:00.000Z'
}

function stateWith(today: string, completedDates: readonly string[], frozenDates: readonly string[]): HabitsState {
  return {
    today,
    habits: [HABIT],
    lifecycle: [
      {
        habitId: HABIT.id,
        date: HABIT.createdOn,
        status: 'active',
        createdAt: HABIT.createdAt
      }
    ],
    entries: completedDates.map((date) => ({
      habitId: HABIT.id,
      date,
      value: 100,
      createdAt: `${date}T20:00:00.000Z`,
      updatedAt: `${date}T20:00:00.000Z`
    })),
    intents: frozenDates.map((date) => ({
      habitId: HABIT.id,
      date,
      createdAt: `${date}T22:00:00.000Z`
    })),
    freezes: frozenDates.map((date) => ({ habitId: HABIT.id, date })),
    grants: [],
    pools: []
  }
}

describe('habit streak metrics', () => {
  it('restores a broken streak after two clean days within 48 hours once that month', () => {
    const state = stateWith('2026-08-04', ['2026-08-01', '2026-08-03', '2026-08-04'], [])
    state.poolDays = [{ date: '2026-08-02', balance: 0 }]
    const metrics = metricsForHabit(state, HABIT)

    expect(metrics.currentStreak).toBe(3)
    expect(metrics.earnBackUsedThisMonth).toBe(true)
  })

  it('requires seven freeze-free days for gold', () => {
    const dates = Array.from({ length: 7 }, (_, index) => `2026-08-0${index + 1}`)
    expect(metricsForHabit(stateWith('2026-08-07', dates, []), HABIT).gold).toBe(true)

    const withoutFourth = dates.filter((date) => date !== '2026-08-04')
    const frozen = metricsForHabit(stateWith('2026-08-07', withoutFourth, ['2026-08-04']), HABIT)
    expect(frozen.currentStreak).toBe(7)
    expect(frozen.gold).toBe(false)
  })
  it('does not offer Earn-Back when freezes were available or the historical balance is unknown', () => {
    const state = stateWith('2026-08-04', ['2026-08-01', '2026-08-03', '2026-08-04'], [])
    expect(metricsForHabit(state, HABIT).currentStreak).toBe(2)
    expect(metricsForHabit({ ...state, poolDays: [{ date: '2026-08-02', balance: 1 }] }, HABIT).earnBackUsedThisMonth).toBe(false)
  })

  it('starts a new streak after reactivation without discarding the previous best', () => {
    const state = stateWith('2026-08-05', ['2026-08-01', '2026-08-02', '2026-08-05'], [])
    state.lifecycle = [...state.lifecycle,
      { habitId: HABIT.id, date: '2026-08-03', status: 'retired', createdAt: '2026-08-03T08:00:00.000Z' },
      { habitId: HABIT.id, date: '2026-08-05', status: 'active', createdAt: '2026-08-05T08:00:00.000Z' }]
    state.poolDays = [{ date: '2026-08-03', balance: 0 }]
    expect(metricsForHabit(state, HABIT)).toMatchObject({ currentStreak: 1, bestStreak: 2, earnBackProgress: 0 })
  })

})
