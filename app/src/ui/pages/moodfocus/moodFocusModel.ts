import type { Focus, Mood, MoodFocusEntry, MoodFocusState } from '../../../shared/moodFocus'

export const MOOD_LEVELS: Readonly<Record<Mood, number>> = {
  Awful: 1,
  Bad: 2,
  Neutral: 3,
  Good: 4,
  Great: 5
}

export const FOCUS_LEVELS: Readonly<Record<Focus, number>> = {
  'Locked Out': 1,
  Low: 2,
  Medium: 3,
  High: 4,
  'Locked In': 5,
  Resting: 0
}

export interface MoodFocusMonthSummary {
  label: string
  loggedDays: number
  moodAverage: number | null
  focusAverage: number | null
  restDays: number
}

export interface MoodFocusTrendPoint {
  month: string
  shortLabel: string
  mood: number | null
  focus: number | null
  loggedDays: number
}

function dateFromIso(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`)
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10
}

export function moodLevel(mood: Mood): number {
  return MOOD_LEVELS[mood]
}

export function focusLevel(focus: Focus): number {
  return FOCUS_LEVELS[focus]
}

export function monthKey(date: string): string {
  return date.slice(0, 7)
}

export function monthShift(month: string, amount: number): string {
  const parsed = new Date(`${month}-01T12:00:00.000Z`)
  parsed.setUTCMonth(parsed.getUTCMonth() + amount)
  return parsed.toISOString().slice(0, 7)
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric'
  }).format(new Date(`${month}-01T12:00:00.000Z`))
}

export function shortMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${month}-01T12:00:00.000Z`))
}

export function dayLabel(date: string, today: string): string {
  if (date === today) {
    return 'Today'
  }
  const yesterday = new Date(`${today}T12:00:00.000Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (date === yesterday.toISOString().slice(0, 10)) {
    return 'Yesterday'
  }
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short'
  }).format(dateFromIso(date))
}

export function fullDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric'
  }).format(dateFromIso(date))
}

export function entriesForMonth(
  entries: readonly MoodFocusEntry[],
  month: string
): readonly MoodFocusEntry[] {
  return entries.filter((entry) => monthKey(entry.date) === month)
}

export function monthSummary(
  entries: readonly MoodFocusEntry[],
  month: string
): MoodFocusMonthSummary {
  const monthEntries = entriesForMonth(entries, month)
  const moods = monthEntries.flatMap((entry) =>
    entry.mood === null ? [] : [moodLevel(entry.mood)]
  )
  const activeFocus = monthEntries.flatMap((entry) =>
    entry.focus === null || entry.focus === 'Resting' ? [] : [focusLevel(entry.focus)]
  )
  return {
    label: monthLabel(month),
    loggedDays: monthEntries.length,
    moodAverage: average(moods),
    focusAverage: average(activeFocus),
    restDays: monthEntries.filter((entry) => entry.focus === 'Resting').length
  }
}

export type MoodFocusTrendRange = 3 | 6 | 12

export function monthTrend(
  state: MoodFocusState,
  endMonth: string,
  range: MoodFocusTrendRange
): readonly MoodFocusTrendPoint[] {
  return Array.from({ length: range }, (_, index) => monthShift(endMonth, index - (range - 1))).map((month) => {
    const summary = monthSummary(state.entries, month)
    return {
      month,
      shortLabel: shortMonthLabel(month),
      mood: summary.moodAverage,
      focus: summary.focusAverage,
      loggedDays: summary.loggedDays
    }
  })
}

export function sixMonthTrend(state: MoodFocusState, endMonth: string): readonly MoodFocusTrendPoint[] {
  return monthTrend(state, endMonth, 6)
}

const MOOD_ORDER: readonly Mood[] = ['Awful', 'Bad', 'Neutral', 'Good', 'Great']
const FOCUS_ORDER: readonly Focus[] = ['Locked Out', 'Low', 'Medium', 'High', 'Locked In']

/** The scale word closest to an average, so a 4.3 mood month reads as "Good". */
export function moodAverageLabel(value: number | null): string | null {
  if (value === null) {
    return null
  }
  return MOOD_ORDER[Math.max(1, Math.min(5, Math.round(value))) - 1] ?? null
}

export function focusAverageLabel(value: number | null): string | null {
  if (value === null) {
    return null
  }
  return FOCUS_ORDER[Math.max(1, Math.min(5, Math.round(value))) - 1] ?? null
}

export interface MoodFocusDayCell {
  date: string
  day: number
  entry: MoodFocusEntry | null
  future: boolean
  today: boolean
}

export interface MoodFocusMonthGrid {
  /** Empty cells before the first day so the grid starts on Monday. */
  leadBlanks: number
  cells: readonly MoodFocusDayCell[]
}

export function daysInMonth(month: string): number {
  const next = monthShift(month, 1)
  return Math.round(
    (new Date(`${next}-01T12:00:00.000Z`).getTime() - new Date(`${month}-01T12:00:00.000Z`).getTime()) / 86400000
  )
}

export function monthGrid(entries: readonly MoodFocusEntry[], month: string, today: string): MoodFocusMonthGrid {
  const weekday = new Date(`${month}-01T12:00:00.000Z`).getUTCDay()
  const byDate = new Map(entriesForMonth(entries, month).map((entry) => [entry.date, entry]))
  return {
    leadBlanks: weekday === 0 ? 6 : weekday - 1,
    cells: Array.from({ length: daysInMonth(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`
      return {
        date,
        day: index + 1,
        entry: byDate.get(date) ?? null,
        future: date > today,
        today: date === today
      }
    })
  }
}

export interface MoodFocusDistributionRow<Level extends string> {
  level: Level
  count: number
  /** Share of rated days on this level, from 0 to 1. */
  share: number
}

export function moodDistribution(entries: readonly MoodFocusEntry[]): readonly MoodFocusDistributionRow<Mood>[] {
  const rated = entries.filter((entry) => entry.mood !== null)
  return [...MOOD_ORDER].reverse().map((level) => {
    const count = rated.filter((entry) => entry.mood === level).length
    return { level, count, share: rated.length === 0 ? 0 : count / rated.length }
  })
}

export function focusDistribution(entries: readonly MoodFocusEntry[]): readonly MoodFocusDistributionRow<Focus>[] {
  const rated = entries.filter((entry) => entry.focus !== null)
  const levels: readonly Focus[] = [...[...FOCUS_ORDER].reverse(), 'Resting']
  return levels.map((level) => {
    const count = rated.filter((entry) => entry.focus === level).length
    return { level, count, share: rated.length === 0 ? 0 : count / rated.length }
  })
}

/** The first month with any check-in; the current month when nothing is logged yet. */
export function earliestEntryMonth(state: MoodFocusState): string {
  const earliestDate = state.entries.reduce(
    (earliest, entry) => (entry.date < earliest ? entry.date : earliest),
    state.today
  )
  return monthKey(earliestDate)
}

export function canEditEntry(date: string, today: string): boolean {
  if (date === today) {
    return true
  }
  const yesterday = new Date(`${today}T12:00:00.000Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return date === yesterday.toISOString().slice(0, 10)
}
