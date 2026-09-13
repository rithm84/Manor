import { describe, expect, it } from 'vitest'

import { calendarDays, type StoredCalendarEvent } from './calendarDays'

function event(starts_at: string, ends_at: string): StoredCalendarEvent {
  return { id: 'event', account_id: 'account', calendar_id: 'calendar', title: 'Appointment', starts_at, ends_at, start_date: null, end_date: null, all_day: false }
}

describe('calendarDays', () => {
  it('preserves local spring DST times', () => {
    const days = calendarDays(event('2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z'), ['2026-03-08'], 'America/Los_Angeles', null)
    expect(days.map((day) => [day.date, day.start, day.end])).toEqual([['2026-03-08', '01:30', '03:30']])
  })
  it('clips midnight exclusively and splits multi-day events', () => {
    const days = calendarDays(event('2026-09-09T06:00:00Z', '2026-09-11T07:00:00Z'), ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], 'America/Los_Angeles', null)
    expect(days.map((day) => [day.date, day.start, day.end])).toEqual([['2026-09-08', '23:00', '24:00'], ['2026-09-09', '00:00', '24:00'], ['2026-09-10', '00:00', '24:00']])
  })
  it('keeps all-day dates independent of timezone', () => {
    const row = { ...event('2026-09-09T00:00:00Z', '2026-09-11T00:00:00Z'), starts_at: null, ends_at: null, all_day: true, start_date: '2026-09-09', end_date: '2026-09-11' }
    expect(calendarDays(row, ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], 'Pacific/Auckland', null).map((day) => day.date)).toEqual(['2026-09-09', '2026-09-10'])
  })
})
