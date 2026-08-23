import { familyQtHeatmap, habits, habitsSummary, TODAY_ISO } from '../../data/mock'
import { addDays, monthKey } from '../../../../shared/habits'
import type {
  HabitDefinition,
  HabitEntry,
  HabitFreezeUsage,
  HabitSeed
} from '../../../../shared/habits'

const CREATED_AT = `${addDays(TODAY_ISO, -364)}T08:00:00.000Z`
const HISTORY_START = addDays(TODAY_ISO, -364)
const CURRENT_MONTH_START = `${monthKey(TODAY_ISO)}-01`

function datesInRun(end: string, length: number): readonly string[] {
  return Array.from({ length }, (_, index) => addDays(end, index - length + 1))
}

function freezeSeed(): readonly HabitFreezeUsage[] {
  return [
    { habitId: familyQtHeatmap.habitId, date: `${monthKey(TODAY_ISO)}-06` },
    { habitId: 'habit-water', date: addDays(TODAY_ISO, -2) },
    { habitId: 'habit-winddown', date: addDays(TODAY_ISO, -1) }
  ]
}

function definitionSeed(): readonly HabitDefinition[] {
  return habits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    kind: habit.quantized === null ? 'binary' : 'quantized',
    targetLabel: habit.quantized?.targetLabel ?? null,
    createdOn: HISTORY_START,
    createdAt: CREATED_AT
  }))
}

function entrySeed(): readonly HabitEntry[] {
  const frozenKeys = new Set(freezeSeed().map((freeze) => `${freeze.habitId}:${freeze.date}`))
  return habits.flatMap((habit) => {
    const dates = new Set<string>()
    const runEnd = habit.doneToday ? TODAY_ISO : addDays(TODAY_ISO, -1)
    datesInRun(runEnd, habit.streak).forEach((date) => dates.add(date))

    if (habit.bestStreak > habit.streak) {
      const currentStart = addDays(runEnd, -habit.streak + 1)
      const bestEnd = addDays(currentStart, -8)
      datesInRun(bestEnd, habit.bestStreak).forEach((date) => dates.add(date))
    }

    const currentMonthPerfectDates = [1, 2, 3, 4, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]
    currentMonthPerfectDates.forEach((day) =>
      dates.add(`${monthKey(TODAY_ISO)}-${String(day).padStart(2, '0')}`)
    )

    const todayValue = habit.quantized?.value ?? (habit.doneToday ? 100 : 0)
    if (todayValue > 0) {
      dates.add(TODAY_ISO)
    } else {
      dates.delete(TODAY_ISO)
    }

    return [...dates]
      .filter((date) => date >= HISTORY_START)
      .filter((date) => !frozenKeys.has(`${habit.id}:${date}`))
      .sort()
      .map((date): HabitEntry => {
        const value = date === TODAY_ISO && todayValue > 0 ? todayValue : 100
        return {
          habitId: habit.id,
          date,
          value: value as HabitEntry['value'],
          createdAt: `${date}T21:00:00.000Z`,
          updatedAt: `${date}T21:00:00.000Z`
        }
      })
  })
}

export function createHabitSeed(): HabitSeed {
  const grantDays = [1, 2, 3, 4, 7, 8, 10, 11, 12, 13]
  return {
    today: TODAY_ISO,
    habits: definitionSeed(),
    lifecycle: habits.map((habit) => ({
      habitId: habit.id,
      date: HISTORY_START,
      status: 'active',
      createdAt: CREATED_AT
    })),
    entries: entrySeed(),
    freezes: freezeSeed(),
    grants: grantDays.map((day) => ({
      date: `${monthKey(TODAY_ISO)}-${String(day).padStart(2, '0')}`
    })),
    finalizedDays: [addDays(TODAY_ISO, -1)],
    monthCapacities: {
      [monthKey(CURRENT_MONTH_START)]: habitsSummary.freezesPerMonth
    }
  }
}
