import { describe, expect, it } from 'vitest'

import { calendarWindow, calendarWindowFilter, withinCalendarWindow } from './calendarWindow'

const week = ['2026-09-14', '2026-09-15', '2026-09-16']
const window = calendarWindow(week)

const timed = (startsAt: string, endsAt: string): Record<string, string | boolean> => ({
  id: 'event', account_id: 'account', calendar_id: 'calendar', title: 'Appointment',
  starts_at: startsAt, ends_at: endsAt, all_day: false
})

const allDay = (startDate: string, endDate: string): Record<string, string | boolean> => ({
  id: 'event', account_id: 'account', calendar_id: 'calendar', title: 'Trip',
  start_date: startDate, end_date: endDate, all_day: true
})

describe('calendarWindow', () => {
  it('widens the instant span by a day on each side of the requested days', () => {
    expect(window.earliest).toBe('2026-09-13T00:00:00.000Z')
    expect(window.latest).toBe('2026-09-18T00:00:00.000Z')
  })

  it('expresses the same span the server filter asks for', () => {
    expect(calendarWindowFilter(window)).toBe(
      'and(all_day.eq.true,start_date.lte.2026-09-16,end_date.gt.2026-09-14),' +
      'and(all_day.eq.false,starts_at.lt.2026-09-18T00:00:00.000Z,ends_at.gt.2026-09-13T00:00:00.000Z)'
    )
  })
})

describe('withinCalendarWindow', () => {
  it('keeps timed events that overlap the span, whatever offset they are stored with', () => {
    expect(withinCalendarWindow(timed('2026-09-15T16:00:00+00:00', '2026-09-15T17:00:00+00:00'), window)).toBe(true)
    expect(withinCalendarWindow(timed('2026-09-12T16:00:00-07:00', '2026-09-13T04:00:00+00:00'), window)).toBe(true)
  })

  it('drops timed events on either side of the span', () => {
    expect(withinCalendarWindow(timed('2026-09-11T16:00:00Z', '2026-09-12T17:00:00Z'), window)).toBe(false)
    expect(withinCalendarWindow(timed('2026-09-18T16:00:00Z', '2026-09-18T17:00:00Z'), window)).toBe(false)
  })

  it('compares all-day events by date, with an exclusive end', () => {
    expect(withinCalendarWindow(allDay('2026-09-16', '2026-09-17'), window)).toBe(true)
    expect(withinCalendarWindow(allDay('2026-09-10', '2026-09-15'), window)).toBe(true)
    expect(withinCalendarWindow(allDay('2026-09-10', '2026-09-14'), window)).toBe(false)
    expect(withinCalendarWindow(allDay('2026-09-17', '2026-09-18'), window)).toBe(false)
  })

  it('drops a row that carries neither range', () => {
    expect(withinCalendarWindow({ id: 'event', all_day: false, starts_at: null, ends_at: null }, window)).toBe(false)
  })
})
