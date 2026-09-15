/** Pomodoro contract: sessions, timer preferences, the timer arithmetic, and monthly statistics. */
export const POMODORO_KINDS = ['focus', 'short_break', 'long_break'] as const
export type PomodoroKind = (typeof POMODORO_KINDS)[number]
export const POMODORO_STATUSES = ['running', 'paused', 'completed', 'abandoned'] as const
export type PomodoroStatus = (typeof POMODORO_STATUSES)[number]

export interface PomodoroSession {
  id: string
  kind: PomodoroKind
  status: PomodoroStatus
  label: string | null
  plannedSeconds: number
  startedAt: string
  pausedAt: string | null
  pausedSeconds: number
  endedAt: string | null
  focusedSeconds: number | null
  localDate: string
  revision: number
}

export interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  autoStartBreaks: boolean
  autoStartFocus: boolean
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, autoStartBreaks: false, autoStartFocus: false
}

export const POMODORO_LABEL_LIMIT = 120
export const POMODORO_MINUTES_LIMIT = 180
export const LONG_BREAK_EVERY_LIMIT = 12

export interface PomodoroState {
  today: string
  timezone: string
  settings: PomodoroSettings
  /** The profile revision the preferences were read at; a preference save carries it. */
  settingsRevision: number
  sessions: readonly PomodoroSession[]
}

export interface PomodoroStartInput {
  kind: PomodoroKind
  label: string | null
}

export interface PomodoroApi {
  load: () => Promise<PomodoroState>
  start: (input: PomodoroStartInput) => Promise<PomodoroState>
  pause: (id: string) => Promise<PomodoroState>
  resume: (id: string) => Promise<PomodoroState>
  /** Closes a session whose time has run out and counts it. */
  complete: (id: string) => Promise<PomodoroState>
  /** Ends a session early; focused time so far is kept but the session does not count as completed. */
  stop: (id: string) => Promise<PomodoroState>
  relabel: (id: string, label: string | null) => Promise<PomodoroState>
  remove: (id: string) => Promise<PomodoroState>
  saveSettings: (patch: Partial<PomodoroSettings>) => Promise<PomodoroState>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function integerValue(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) throw new TypeError(`${label} must be an integer of at least ${minimum}`)
  return value
}

function timestampValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`)
  return value
}

function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null || value === undefined ? null : parse(value)
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new TypeError(`${label} must be one of ${options.join(', ')}`)
  return value as T
}

export function parsePomodoroLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new TypeError('label must be text')
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length > POMODORO_LABEL_LIMIT) throw new RangeError(`label must be ${POMODORO_LABEL_LIMIT} characters or fewer`)
  return trimmed
}

export function parsePomodoroSession(value: unknown): PomodoroSession {
  const row = recordValue(value, 'pomodoro session')
  if (typeof row.id !== 'string' || row.id === '') throw new TypeError('session.id must be a non-empty string')
  if (typeof row.localDate !== 'string' || !ISO_DATE_PATTERN.test(row.localDate)) throw new TypeError('session.localDate must use YYYY-MM-DD format')
  const status = oneOf(row.status, POMODORO_STATUSES, 'session.status')
  const session: PomodoroSession = {
    id: row.id,
    kind: oneOf(row.kind, POMODORO_KINDS, 'session.kind'),
    status,
    label: parsePomodoroLabel(row.label),
    plannedSeconds: integerValue(row.plannedSeconds, 'session.plannedSeconds', 1),
    startedAt: timestampValue(row.startedAt, 'session.startedAt'),
    pausedAt: nullable(row.pausedAt, (paused) => timestampValue(paused, 'session.pausedAt')),
    pausedSeconds: integerValue(row.pausedSeconds, 'session.pausedSeconds', 0),
    endedAt: nullable(row.endedAt, (ended) => timestampValue(ended, 'session.endedAt')),
    focusedSeconds: nullable(row.focusedSeconds, (focused) => integerValue(focused, 'session.focusedSeconds', 0)),
    localDate: row.localDate,
    revision: integerValue(row.revision, 'session.revision', 1)
  }
  if ((status === 'paused') !== (session.pausedAt !== null)) throw new TypeError('a paused session carries pausedAt and no other status does')
  if (isFinished(session) !== (session.endedAt !== null && session.focusedSeconds !== null)) throw new TypeError('a finished session carries endedAt and focusedSeconds')
  return session
}

/** Preferences as stored under `profiles.settings.pomodoro`; missing keys take the defaults. */
export function parsePomodoroSettings(value: unknown): PomodoroSettings {
  if (value === null || value === undefined) return DEFAULT_POMODORO_SETTINGS
  const stored = recordValue(value, 'pomodoro settings')
  const minutes = (key: keyof PomodoroSettings, fallback: number): number => {
    const candidate = stored[snakeCase(key)]
    if (candidate === undefined) return fallback
    const parsed = integerValue(candidate, key, 1)
    if (parsed > POMODORO_MINUTES_LIMIT) throw new RangeError(`${key} must be ${POMODORO_MINUTES_LIMIT} or fewer`)
    return parsed
  }
  const flag = (key: keyof PomodoroSettings, fallback: boolean): boolean => {
    const candidate = stored[snakeCase(key)]
    if (candidate === undefined) return fallback
    if (typeof candidate !== 'boolean') throw new TypeError(`${key} must be true or false`)
    return candidate
  }
  const longBreakEvery = stored.long_break_every === undefined ? DEFAULT_POMODORO_SETTINGS.longBreakEvery : integerValue(stored.long_break_every, 'longBreakEvery', 1)
  if (longBreakEvery > LONG_BREAK_EVERY_LIMIT) throw new RangeError(`longBreakEvery must be ${LONG_BREAK_EVERY_LIMIT} or fewer`)
  return {
    focusMinutes: minutes('focusMinutes', DEFAULT_POMODORO_SETTINGS.focusMinutes),
    shortBreakMinutes: minutes('shortBreakMinutes', DEFAULT_POMODORO_SETTINGS.shortBreakMinutes),
    longBreakMinutes: minutes('longBreakMinutes', DEFAULT_POMODORO_SETTINGS.longBreakMinutes),
    longBreakEvery,
    autoStartBreaks: flag('autoStartBreaks', DEFAULT_POMODORO_SETTINGS.autoStartBreaks),
    autoStartFocus: flag('autoStartFocus', DEFAULT_POMODORO_SETTINGS.autoStartFocus)
  }
}

/** The stored (snake_case) form of a preferences patch, validated the way the server validates it. */
export function settingsPatchRow(patch: Partial<PomodoroSettings>): Record<string, number | boolean> {
  const row: Record<string, number | boolean> = {}
  for (const [key, value] of Object.entries(patch) as [keyof PomodoroSettings, number | boolean | undefined][]) {
    if (value === undefined) continue
    if (key === 'autoStartBreaks' || key === 'autoStartFocus') {
      if (typeof value !== 'boolean') throw new TypeError(`${key} must be true or false`)
    } else {
      const limit = key === 'longBreakEvery' ? LONG_BREAK_EVERY_LIMIT : POMODORO_MINUTES_LIMIT
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > limit) throw new RangeError(`${key} must be a whole number from 1 to ${limit}`)
    }
    row[snakeCase(key)] = value
  }
  if (Object.keys(row).length === 0) throw new TypeError('a preferences change must include at least one preference')
  return row
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function isActive(session: PomodoroSession): boolean {
  return session.status === 'running' || session.status === 'paused'
}

export function isFinished(session: PomodoroSession): boolean {
  return session.status === 'completed' || session.status === 'abandoned'
}

export function activeSession(sessions: readonly PomodoroSession[]): PomodoroSession | null {
  return sessions.find(isActive) ?? null
}

export function plannedSeconds(kind: PomodoroKind, settings: PomodoroSettings): number {
  const minutes = kind === 'focus' ? settings.focusMinutes : kind === 'short_break' ? settings.shortBreakMinutes : settings.longBreakMinutes
  return minutes * 60
}

export interface PomodoroClock {
  /** Seconds the timer has actually run, pauses excluded. */
  elapsedSeconds: number
  remainingSeconds: number
  /** 0 at the start, 1 when the planned time has run out. */
  progress: number
  due: boolean
}

/** Where a session's timer stands at an instant; a paused session stands still at the moment it paused. */
export function sessionClock(session: PomodoroSession, nowMs: number): PomodoroClock {
  const started = Date.parse(session.startedAt)
  const reference = session.status === 'paused' && session.pausedAt !== null ? Date.parse(session.pausedAt) : isFinished(session) && session.endedAt !== null ? Date.parse(session.endedAt) : nowMs
  const elapsedSeconds = Math.max(0, Math.floor((reference - started) / 1000) - session.pausedSeconds)
  const remainingSeconds = Math.max(0, session.plannedSeconds - elapsedSeconds)
  return { elapsedSeconds, remainingSeconds, progress: Math.min(1, elapsedSeconds / session.plannedSeconds), due: remainingSeconds === 0 }
}

/** `mm:ss`, or `h:mm:ss` from an hour up. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

/** Whole minutes for statistics: `1h 05m` from an hour up, `45m` below, `0m` when nothing. */
export function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`
}

export function completedFocusOn(sessions: readonly PomodoroSession[], date: string): number {
  return sessions.filter((session) => session.kind === 'focus' && session.status === 'completed' && session.localDate === date).length
}

/**
 * What comes after a session ends. A completed focus session earns a break, the long one when the day's
 * completed count reaches the configured cycle; every break, and an abandoned focus session, leads back to focus.
 */
export function nextKind(ended: PomodoroSession, sessions: readonly PomodoroSession[], settings: PomodoroSettings): PomodoroKind {
  if (ended.kind !== 'focus' || ended.status !== 'completed') return 'focus'
  const completedToday = completedFocusOn(sessions, ended.localDate)
  return completedToday > 0 && completedToday % settings.longBreakEvery === 0 ? 'long_break' : 'short_break'
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function shiftMonth(month: string, amount: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + amount, 1))
  return shifted.toISOString().slice(0, 7)
}

export function daysOfMonth(month: string): readonly string[] {
  const [year, monthIndex] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export interface PomodoroDay {
  date: string
  completed: number
  focusedSeconds: number
}

export interface PomodoroMonthStats {
  month: string
  completed: number
  abandoned: number
  focusedSeconds: number
  activeDays: number
  /** Days of the month that have passed, the current day included, so rates read against real time. */
  elapsedDays: number
  bestDay: PomodoroDay | null
  /** Consecutive days with a completed focus session, ending today or yesterday. */
  streak: number
  days: readonly PomodoroDay[]
}

/** Focus sessions of a month, both outcomes; breaks are not statistics. */
export function focusSessionsOfMonth(sessions: readonly PomodoroSession[], month: string): readonly PomodoroSession[] {
  return sessions.filter((session) => session.kind === 'focus' && isFinished(session) && monthOf(session.localDate) === month)
}

export function monthStats(sessions: readonly PomodoroSession[], month: string, today: string): PomodoroMonthStats {
  const focus = focusSessionsOfMonth(sessions, month)
  const byDay = new Map<string, PomodoroDay>()
  for (const date of daysOfMonth(month)) byDay.set(date, { date, completed: 0, focusedSeconds: 0 })
  let completed = 0
  let abandoned = 0
  let focusedSeconds = 0
  for (const session of focus) {
    const day = byDay.get(session.localDate)
    if (day === undefined) continue
    const seconds = session.focusedSeconds ?? 0
    focusedSeconds += seconds
    day.focusedSeconds += seconds
    if (session.status === 'completed') {
      completed += 1
      day.completed += 1
    } else abandoned += 1
  }
  const days = [...byDay.values()]
  const activeDays = days.filter((day) => day.completed > 0).length
  const bestDay = days.reduce<PomodoroDay | null>((best, day) => day.completed > 0 && (best === null || day.completed > best.completed || (day.completed === best.completed && day.focusedSeconds > best.focusedSeconds)) ? day : best, null)
  const elapsedDays = monthOf(today) === month ? Number(today.slice(8, 10)) : today > month ? days.length : 0
  return { month, completed, abandoned, focusedSeconds, activeDays, elapsedDays, bestDay, streak: focusStreak(sessions, today), days }
}

/** Consecutive days with a completed focus session, counting back from today, or from yesterday when today is still open. */
export function focusStreak(sessions: readonly PomodoroSession[], today: string): number {
  const completedDays = new Set(sessions.filter((session) => session.kind === 'focus' && session.status === 'completed').map((session) => session.localDate))
  let cursor = completedDays.has(today) ? today : shiftDate(today, -1)
  let streak = 0
  while (completedDays.has(cursor)) {
    streak += 1
    cursor = shiftDate(cursor, -1)
  }
  return streak
}

/** The earliest month with a finished focus session, or the current month for a fresh account. */
export function earliestSessionMonth(sessions: readonly PomodoroSession[], today: string): string {
  const months = sessions.filter(isFinished).map((session) => monthOf(session.localDate))
  return months.length === 0 ? monthOf(today) : months.reduce((earliest, month) => (month < earliest ? month : earliest))
}
