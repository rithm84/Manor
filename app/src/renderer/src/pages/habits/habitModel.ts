import { familyQtHeatmap } from '../../data/mock'
import type { Habit, HabitDayMark } from '../../data/mock'

/** How the habit is logged; 'steps' habits fill up through the day. */
export type HabitKind = 'check' | 'steps'

export type HabitCadence = 'Every day' | 'Weekdays' | 'Weekends'

/** Local view model over the mock habit: page state only, no persistence. */
export interface HabitVM extends Habit {
  paused: boolean
  cadence: HabitCadence
}

export interface HabitDraft {
  name: string
  cadence: HabitCadence
  kind: HabitKind
  targetLabel: string
}

export interface MonthCell {
  day: number
  mark: HabitDayMark
}

export const MONTH_LABEL = 'August 2026'
export const MONTH_DAY_COUNT = 31
export const MONTH_LOGGED_THROUGH = 20
/** Aug 1, 2026 falls on a Friday: four leading blanks in a Mon-first grid. */
export const MONTH_LEAD_BLANKS = 4

const WEEK_DAY_OF_MONTH: readonly number[] = [18, 19, 20]

/**
 * August cells for one habit. Family QT uses the canonical heatmap; other
 * habits derive their month from streak history so nothing contradicts the
 * week strip (Aug 18..20 always comes straight from `week`).
 */
export function monthCellsFor(habit: HabitVM): readonly MonthCell[] {
  if (habit.id === familyQtHeatmap.habitId) {
    return familyQtHeatmap.days
  }
  const weekMarks = new Map<number, HabitDayMark>(
    WEEK_DAY_OF_MONTH.map((day, index) => [day, habit.week[index] as HabitDayMark])
  )
  const brandNew = habit.streak === 0 && habit.bestStreak === 0
  const runStart = habit.doneToday ? 0 : 1
  const cells: MonthCell[] = []
  for (let day = 1; day <= MONTH_LOGGED_THROUGH; day += 1) {
    const weekMark = weekMarks.get(day)
    if (weekMark !== undefined) {
      cells.push({ day, mark: weekMark })
      continue
    }
    if (brandNew) {
      cells.push({ day, mark: 'future' })
      continue
    }
    const offset = MONTH_LOGGED_THROUGH - day
    cells.push({ day, mark: offset === runStart + habit.streak ? 'missed' : 'done' })
  }
  return cells
}

/** "52 / 105 g" style label for a steps habit at `value` percent of its target. */
export function stepAmountLabel(targetLabel: string, value: number): string {
  const target = Number.parseFloat(targetLabel)
  if (Number.isNaN(target)) {
    return `${value}%`
  }
  const amount = Math.round((target * value) / 100)
  return `${amount} / ${targetLabel}`
}
