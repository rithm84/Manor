import { describe, expect, it } from 'vitest'

import {
  DEFAULT_POMODORO_SETTINGS,
  earliestSessionMonth,
  focusStreak,
  formatClock,
  formatMinutes,
  monthStats,
  nextKind,
  parsePomodoroSession,
  parsePomodoroSettings,
  sessionClock,
  settingsPatchRow
} from './pomodoro'
import type { PomodoroSession } from './pomodoro'

function session(overrides: Partial<PomodoroSession>): PomodoroSession {
  return {
    id: 'p1', kind: 'focus', status: 'completed', label: null, plannedSeconds: 1500,
    startedAt: '2026-09-10T16:00:00.000Z', pausedAt: null, pausedSeconds: 0, endedAt: '2026-09-10T16:25:00.000Z',
    focusedSeconds: 1500, localDate: '2026-09-10', revision: 2, ...overrides
  }
}

describe('parsePomodoroSession', () => {
  it('accepts a camel-cased row and trims the label', () => {
    const parsed = parsePomodoroSession({ ...session({}), label: '  Deep work  ' })
    expect(parsed.label).toBe('Deep work')
    expect(parsed.status).toBe('completed')
  })
  it('rejects a paused session without pausedAt and a finished one without an end', () => {
    expect(() => parsePomodoroSession(session({ status: 'paused', pausedAt: null, endedAt: null, focusedSeconds: null }))).toThrow(/pausedAt/)
    expect(() => parsePomodoroSession(session({ status: 'completed', endedAt: null }))).toThrow(/endedAt/)
  })
})

describe('parsePomodoroSettings', () => {
  it('fills missing keys with the defaults and reads stored snake_case keys', () => {
    expect(parsePomodoroSettings(null)).toEqual(DEFAULT_POMODORO_SETTINGS)
    expect(parsePomodoroSettings({ focus_minutes: 50, auto_start_breaks: true })).toEqual({ ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 50, autoStartBreaks: true })
  })
  it('refuses out-of-range minutes', () => {
    expect(() => parsePomodoroSettings({ focus_minutes: 0 })).toThrow()
    expect(() => parsePomodoroSettings({ long_break_every: 13 })).toThrow(/12/)
  })
})

describe('settingsPatchRow', () => {
  it('produces the stored keys and validates values', () => {
    expect(settingsPatchRow({ focusMinutes: 45, autoStartFocus: true })).toEqual({ focus_minutes: 45, auto_start_focus: true })
    expect(() => settingsPatchRow({ shortBreakMinutes: 0 })).toThrow(/1 to 180/)
    expect(() => settingsPatchRow({})).toThrow()
  })
})

describe('sessionClock', () => {
  const started = Date.parse('2026-09-10T16:00:00.000Z')
  it('counts down a running session and excludes paused time', () => {
    const running = session({ status: 'running', endedAt: null, focusedSeconds: null, pausedSeconds: 60 })
    const clock = sessionClock(running, started + 10 * 60 * 1000)
    expect(clock.elapsedSeconds).toBe(540)
    expect(clock.remainingSeconds).toBe(960)
    expect(clock.progress).toBeCloseTo(0.36)
    expect(clock.due).toBe(false)
  })
  it('stands still while paused and reads as due once the plan has run out', () => {
    const paused = session({ status: 'paused', endedAt: null, focusedSeconds: null, pausedAt: '2026-09-10T16:05:00.000Z' })
    expect(sessionClock(paused, started + 60 * 60 * 1000).remainingSeconds).toBe(1200)
    const running = session({ status: 'running', endedAt: null, focusedSeconds: null })
    const clock = sessionClock(running, started + 26 * 60 * 1000)
    expect(clock.remainingSeconds).toBe(0)
    expect(clock.due).toBe(true)
    expect(clock.progress).toBe(1)
  })
})

describe('formatting', () => {
  it('formats the clock and minute totals', () => {
    expect(formatClock(1500)).toBe('25:00')
    expect(formatClock(59)).toBe('00:59')
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatMinutes(0)).toBe('0m')
    expect(formatMinutes(45 * 60)).toBe('45m')
    expect(formatMinutes(3900)).toBe('1h 05m')
    expect(formatMinutes(7200)).toBe('2h')
  })
})

describe('nextKind', () => {
  const completedToday = (count: number): PomodoroSession[] => Array.from({ length: count }, (_, index) => session({ id: `s${index}` }))
  it('offers a short break until the cycle completes, then a long one', () => {
    const three = completedToday(3)
    expect(nextKind(three[0], three, DEFAULT_POMODORO_SETTINGS)).toBe('short_break')
    const four = completedToday(4)
    expect(nextKind(four[0], four, DEFAULT_POMODORO_SETTINGS)).toBe('long_break')
  })
  it('returns to focus after a break or an abandoned focus session', () => {
    const brk = session({ kind: 'short_break' })
    expect(nextKind(brk, [brk], DEFAULT_POMODORO_SETTINGS)).toBe('focus')
    const abandoned = session({ status: 'abandoned', focusedSeconds: 300 })
    expect(nextKind(abandoned, [abandoned], DEFAULT_POMODORO_SETTINGS)).toBe('focus')
  })
})

describe('monthStats', () => {
  const sessions = [
    session({ id: 'a', localDate: '2026-09-01' }),
    session({ id: 'b', localDate: '2026-09-01' }),
    session({ id: 'c', localDate: '2026-09-02', status: 'abandoned', focusedSeconds: 600 }),
    session({ id: 'd', localDate: '2026-09-14' }),
    session({ id: 'e', localDate: '2026-09-13' }),
    session({ id: 'f', localDate: '2026-08-30' }),
    session({ id: 'brk', kind: 'short_break', localDate: '2026-09-14', focusedSeconds: 300 })
  ]
  it('totals completed focus sessions, focused time, active days, and the best day', () => {
    const stats = monthStats(sessions, '2026-09', '2026-09-14')
    expect(stats.completed).toBe(4)
    expect(stats.abandoned).toBe(1)
    expect(stats.focusedSeconds).toBe(4 * 1500 + 600)
    expect(stats.activeDays).toBe(3)
    expect(stats.elapsedDays).toBe(14)
    expect(stats.bestDay?.date).toBe('2026-09-01')
    expect(stats.days).toHaveLength(30)
    expect(stats.days[0]).toEqual({ date: '2026-09-01', completed: 2, focusedSeconds: 3000 })
  })
  it('counts the streak from today, or from yesterday while today is open', () => {
    expect(focusStreak(sessions, '2026-09-14')).toBe(2)
    expect(focusStreak(sessions, '2026-09-15')).toBe(2)
    expect(focusStreak(sessions, '2026-09-16')).toBe(0)
  })
  it('measures a past month in full and a future month as empty', () => {
    expect(monthStats(sessions, '2026-08', '2026-09-14').elapsedDays).toBe(31)
    expect(monthStats(sessions, '2026-10', '2026-09-14').elapsedDays).toBe(0)
  })
  it('finds the earliest month with sessions', () => {
    expect(earliestSessionMonth(sessions, '2026-09-14')).toBe('2026-08')
    expect(earliestSessionMonth([], '2026-09-14')).toBe('2026-09')
  })
})
