import type { PomodoroKind, PomodoroSession } from '../../../shared/pomodoro'

export function kindLabel(kind: PomodoroKind): string {
  return kind === 'focus' ? 'Focus' : kind === 'short_break' ? 'Short break' : 'Long break'
}

export function kindTone(kind: PomodoroKind): 'focus' | 'break' {
  return kind === 'focus' ? 'focus' : 'break'
}

export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthIndex - 1, 1)))
}

export function shortDayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`))
}

/** "Today", "Yesterday", or a weekday with the date, for the session log's day headings. */
export function dayHeading(date: string, today: string, yesterday: string): string {
  if (date === today) return 'Today'
  if (date === yesterday) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`))
}

export function startTimeLabel(session: PomodoroSession, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(session.startedAt))
}

export interface SessionDay {
  date: string
  sessions: readonly PomodoroSession[]
}

/** Finished focus sessions of a month grouped by local day, newest day and newest session first. */
export function sessionDays(sessions: readonly PomodoroSession[], month: string): readonly SessionDay[] {
  const byDay = new Map<string, PomodoroSession[]>()
  for (const session of sessions) {
    if (session.kind !== 'focus' || (session.status !== 'completed' && session.status !== 'abandoned') || !session.localDate.startsWith(month)) continue
    const list = byDay.get(session.localDate) ?? []
    list.push(session)
    byDay.set(session.localDate, list)
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, list]) => ({ date, sessions: [...list].sort((left, right) => right.startedAt.localeCompare(left.startedAt)) }))
}

/** How many of the current cycle's focus sessions are done, so the dots read as progress toward the long break. */
export function cyclePosition(completedToday: number, longBreakEvery: number): number {
  if (completedToday === 0) return 0
  const remainder = completedToday % longBreakEvery
  return remainder === 0 ? longBreakEvery : remainder
}
