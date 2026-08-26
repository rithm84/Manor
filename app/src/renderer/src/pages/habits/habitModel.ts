import {
  addDays,
  daysBetween,
  markForDate,
  metricsForHabit,
  statusOn
} from '../../../../shared/habits'
import type {
  HabitDayMark,
  HabitDefinition,
  HabitDraft,
  HabitEntry,
  HabitLifecycleStatus,
  HabitMetrics,
  HabitsState
} from '../../../../shared/habits'

export type { HabitDraft }

export interface HabitWeekDay {
  date: string
  letter: string
  mark: HabitDayMark
  selected: boolean
}

export interface HabitViewModel {
  definition: HabitDefinition
  status: HabitLifecycleStatus
  selectedStatus: HabitLifecycleStatus | null
  entry: HabitEntry | null
  metrics: HabitMetrics
  week: readonly HabitWeekDay[]
  selectedDateMark: HabitDayMark
  canDelete: boolean
}

export interface HabitMonthRow {
  habit: HabitDefinition
  status: HabitLifecycleStatus | null
  days: readonly HabitDayMark[]
  completedDays: number
  partialDays: number
  frozenDays: number
  trackedDays: number
  completionRate: number
}

export interface HabitMonthSummary {
  month: string
  label: string
  rows: readonly HabitMonthRow[]
  perfectDays: number
  frozenDays: number
  completionRate: number
}

export interface HabitTrendMonth {
  month: string
  shortLabel: string
  completionRate: number
  perfectDays: number
}

const WEEK_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function startOfWeek(date: string): string {
  const weekday = utcDate(date).getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(date, offset)
}

export function dateLabel(date: string, today: string): string {
  if (date === today) {
    return 'Today'
  }
  if (date === addDays(today, -1)) {
    return 'Yesterday'
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(utcDate(date))
}

export function fullDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(utcDate(date))
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(utcDate(`${month}-01`))
}

export function monthShift(month: string, amount: number): string {
  const date = utcDate(`${month}-01`)
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 7)
}

export function historyMonthAfterNavigation(
  month: string,
  amount: -1 | 1,
  today: string
): string {
  const candidate = monthShift(month, amount)
  return candidate > today.slice(0, 7) ? month : candidate
}

/** The first month with any habit data: the earliest creation date or entry. */
export function earliestHistoryMonth(state: HabitsState): string {
  const earliestDate = [
    ...state.habits.map((habit) => habit.createdOn),
    ...state.entries.map((entry) => entry.date)
  ].reduce((earliest, date) => (date < earliest ? date : earliest), state.today)
  return earliestDate.slice(0, 7)
}

export function daysInMonth(month: string): number {
  const date = utcDate(`${month}-01`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  date.setUTCDate(0)
  return date.getUTCDate()
}

export function selectedEntry(
  state: HabitsState,
  habitId: string,
  date: string
): HabitEntry | null {
  return state.entries.find((entry) => entry.habitId === habitId && entry.date === date) ?? null
}

export function habitViewModel(
  state: HabitsState,
  habit: HabitDefinition,
  selectedDate: string
): HabitViewModel {
  const weekStart = startOfWeek(selectedDate)
  const status = statusOn(habit.id, state.today, state.lifecycle) ?? 'retired'
  const selectedStatus = statusOn(habit.id, selectedDate, state.lifecycle)
  const hasHistory =
    state.entries.some((entry) => entry.habitId === habit.id) ||
    state.freezes.some((freeze) => freeze.habitId === habit.id)
  return {
    definition: habit,
    status,
    selectedStatus,
    entry: selectedEntry(state, habit.id, selectedDate),
    metrics: metricsForHabit(state, habit),
    week: WEEK_LETTERS.map((letter, index) => {
      const date = addDays(weekStart, index)
      return { date, letter, mark: markForDate(state, habit, date), selected: date === selectedDate }
    }),
    selectedDateMark: markForDate(state, habit, selectedDate),
    canDelete: !hasHistory && habit.createdOn === state.today
  }
}

export function activeOnDate(state: HabitsState, date: string): readonly HabitDefinition[] {
  return state.habits.filter((habit) => statusOn(habit.id, date, state.lifecycle) === 'active')
}

export function draftForHabit(habit: HabitDefinition): HabitDraft {
  return {
    name: habit.name,
    kind: habit.kind,
    targetLabel: habit.targetLabel
  }
}

export function stepAmountLabel(targetLabel: string, value: number): string {
  const target = Number.parseFloat(targetLabel)
  if (Number.isNaN(target)) {
    return `${value}%`
  }
  const suffix = targetLabel.replace(String(target), '').trim()
  const amount = Math.round((target * value) / 100)
  return `${amount}${suffix === '' ? '' : ` ${suffix}`} / ${targetLabel}`
}

/** Retiring a habit erases its history, so it drops out of every summary. */
function retiredNow(state: HabitsState, habitId: string): boolean {
  return statusOn(habitId, state.today, state.lifecycle) === 'retired'
}

export function monthSummary(state: HabitsState, month: string): HabitMonthSummary {
  const dayCount = daysInMonth(month)
  const dates = Array.from(
    { length: dayCount },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
  )
  const lastDate = dates.at(-1)
  if (lastDate === undefined) {
    throw new Error(`Month ${month} has no dates`)
  }
  const rows = state.habits
    .filter((habit) => habit.createdOn <= lastDate && !retiredNow(state, habit.id))
    .map((habit): HabitMonthRow => {
      const days = dates.map((date) => markForDate(state, habit, date))
      const trackedDays = days.filter(
        (mark) => !['future', 'paused', 'inactive'].includes(mark)
      ).length
      const completedDays = days.filter((mark) => mark === 'complete').length
      return {
        habit,
        status: statusOn(habit.id, lastDate, state.lifecycle),
        days,
        completedDays,
        partialDays: days.filter((mark) => mark === 'partial').length,
        frozenDays: days.filter((mark) => mark === 'frozen').length,
        trackedDays,
        completionRate:
          trackedDays === 0 ? 0 : Math.round((completedDays / trackedDays) * 100)
      }
    })
  const pastDates = dates.filter((date) => date < state.today)
  const perfectDays = pastDates.filter((date) => {
    const active = activeOnDate(state, date).filter((habit) => !retiredNow(state, habit.id))
    return active.length > 0 && active.every((habit) => markForDate(state, habit, date) === 'complete')
  }).length
  const trackedMarks = rows
    .flatMap((row) => row.days)
    .filter((mark) => !['future', 'paused', 'inactive', 'pending'].includes(mark))
  const completeMarks = trackedMarks.filter((mark) => mark === 'complete')
  return {
    month,
    label: monthLabel(month),
    rows,
    perfectDays,
    frozenDays: rows.reduce((total, row) => total + row.frozenDays, 0),
    completionRate:
      trackedMarks.length === 0 ? 0 : Math.round((completeMarks.length / trackedMarks.length) * 100)
  }
}

export function twelveMonthTrend(state: HabitsState, endingMonth: string): readonly HabitTrendMonth[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = monthShift(endingMonth, index - 11)
    const summary = monthSummary(state, month)
    return {
      month,
      shortLabel: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
        utcDate(`${month}-01`)
      ),
      completionRate: summary.completionRate,
      perfectDays: summary.perfectDays
    }
  })
}

export function daysSinceCreated(habit: HabitDefinition, today: string): number {
  return Math.max(1, daysBetween(habit.createdOn, today) + 1)
}
