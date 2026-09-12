import { describe, expect, it } from 'vitest'

import type {
  HabitDefinition,
  HabitEntry,
  HabitLifecycleEvent,
  HabitsState
} from '../../../shared/habits'
import {
  earliestHistoryMonth,
  habitTrend,
  historyMonthAfterNavigation,
  monthSummary
} from './habitModel'

const ACTIVE_HABIT: HabitDefinition = {
  id: 'active-habit',
  name: 'Active habit',
  kind: 'quantized',
  targetLabel: '4 sets',
  createdOn: '2026-08-01',
  createdAt: '2026-08-01T08:00:00.000Z'
}

const RETIRED_HABIT: HabitDefinition = {
  id: 'retired-habit',
  name: 'Retired habit',
  kind: 'binary',
  targetLabel: null,
  createdOn: '2026-08-01',
  createdAt: '2026-08-01T08:01:00.000Z'
}

function lifecycle(
  habitId: string,
  date: string,
  status: 'active' | 'paused' | 'retired'
): HabitLifecycleEvent {
  return { habitId, date, status, createdAt: `${date}T08:00:00.000Z` }
}

function entry(habitId: string, date: string, value: 25 | 50 | 75 | 100): HabitEntry {
  return {
    habitId,
    date,
    value,
    createdAt: `${date}T20:00:00.000Z`,
    updatedAt: `${date}T20:00:00.000Z`
  }
}

function historyState(): HabitsState {
  return {
    today: '2026-08-05',
    habits: [ACTIVE_HABIT, RETIRED_HABIT],
    lifecycle: [
      lifecycle(ACTIVE_HABIT.id, '2026-08-01', 'active'),
      lifecycle(RETIRED_HABIT.id, '2026-08-01', 'active'),
      lifecycle(RETIRED_HABIT.id, '2026-08-04', 'retired')
    ],
    entries: [
      entry(ACTIVE_HABIT.id, '2026-08-01', 100),
      entry(ACTIVE_HABIT.id, '2026-08-02', 50),
      entry(RETIRED_HABIT.id, '2026-08-01', 100),
      entry(RETIRED_HABIT.id, '2026-08-02', 100)
    ],
    intents: [],
    freezes: [{ habitId: ACTIVE_HABIT.id, date: '2026-08-03' }],
    grants: [],
    pools: []
  }
}

describe('habit history aggregation', () => {
  it('keeps retired habits in the months they ran and separates day marks', () => {
    const summary = monthSummary(historyState(), '2026-08')
    const active = summary.rows.find((row) => row.habit.id === ACTIVE_HABIT.id)
    const retired = summary.rows.find((row) => row.habit.id === RETIRED_HABIT.id)

    expect(active).toMatchObject({
      completedDays: 1,
      partialDays: 1,
      frozenDays: 1,
      trackedDays: 4,
      completionRate: 25
    })
    // Retired on the 4th: three tracked days of preserved history, then inactive.
    expect(retired).toMatchObject({
      completedDays: 2,
      trackedDays: 3,
      status: 'retired'
    })
    expect(summary.rows).toHaveLength(2)
    expect(summary.frozenDays).toBe(1)
  })

  it('keeps twelve-month history chronological and ending on the selected month', () => {
    const trend = habitTrend(historyState(), '2026-08', 12, null)

    expect(trend).toHaveLength(12)
    expect(trend[0]?.month).toBe('2025-09')
    expect(trend.at(-1)?.month).toBe('2026-08')
  })

  it('excludes future and inactive days from trend denominators', () => {
    const trend = habitTrend(historyState(), '2026-08', 3, null)

    expect(trend.map((item) => item.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(trend[0]).toMatchObject({ completionRate: null, completedDays: 0, trackedDays: 0 })
    expect(trend[1]).toMatchObject({ completionRate: null, completedDays: 0, trackedDays: 0 })
    expect(trend[2]).toMatchObject({ completionRate: 43, completedDays: 3, trackedDays: 7 })
  })

  it('keeps a retired habit selectable without counting dates after retirement', () => {
    const trend = habitTrend(historyState(), '2026-08', 3, RETIRED_HABIT.id)

    expect(trend.at(-1)).toMatchObject({ completionRate: 67, completedDays: 2, trackedDays: 3 })
  })
})

describe('habit history month navigation', () => {
  it('moves backward and blocks navigation beyond the current month', () => {
    expect(historyMonthAfterNavigation('2026-08', -1, '2026-08-05')).toBe('2026-07')
    expect(historyMonthAfterNavigation('2026-07', 1, '2026-08-05')).toBe('2026-08')
    expect(historyMonthAfterNavigation('2026-08', 1, '2026-08-05')).toBe('2026-08')
  })

  it('bounds backward navigation at the earliest habit or entry month', () => {
    expect(earliestHistoryMonth(historyState())).toBe('2026-08')

    const backdated = historyState()
    expect(
      earliestHistoryMonth({
        ...backdated,
        habits: [{ ...ACTIVE_HABIT, createdOn: '2026-05-14' }, RETIRED_HABIT]
      })
    ).toBe('2026-05')
    expect(
      earliestHistoryMonth({ ...backdated, habits: [], entries: [], freezes: [] })
    ).toBe('2026-08')
  })
})
