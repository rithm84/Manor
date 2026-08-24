import { describe, expect, it } from 'vitest'

import {
  calendarEventForOccurrence,
  calendarGridDate,
  calendarGridTime,
  calendarLocalDate,
  calendarWallTimeToInstant,
  convertCalendarWallTime,
  excludeCalendarOccurrence,
  expandCalendarEvent,
  parseCalendarEvent,
  parseCalendarSeed,
  shiftCalendarEvent
} from './calendar'
import type { CalendarEventRecord } from './calendar'

const EVENT: CalendarEventRecord = {
  id: 'event-1',
  calendarId: 'calendar-1',
  title: 'Studio block',
  eventType: 'event',
  allDay: false,
  startDate: '2026-08-18',
  endDate: '2026-08-18',
  startTime: '10:00',
  endTime: '11:30',
  timeZone: 'America/Los_Angeles',
  location: '',
  description: '',
  conferenceUrl: '',
  visibility: 'default',
  busyStatus: 'busy',
  reminders: [10],
  notePageIds: [],
  recurrence: null,
  recurrenceParentId: null,
  recurrenceOriginalDate: null,
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z'
}

describe('calendar domain', () => {
  it('rejects timed events whose end is not after their start', () => {
    expect(() => parseCalendarEvent({ ...EVENT, endTime: '09:00' })).toThrow(/after its start/)
  })

  it('validates seed relationships', () => {
    expect(() => parseCalendarSeed({
      calendars: [],
      events: [EVENT],
      settings: {
        weekStart: 'monday',
        showWeekends: true,
        workingHoursStart: '08:00',
        workingHoursEnd: '18:00',
        timeFormat: '12h',
        primaryTimeZone: 'America/Los_Angeles',
        secondaryTimeZone: null
      }
    })).toThrow(/missing calendar/)
  })

  it('expands interval weekly recurrence on specific weekdays with a count boundary', () => {
    const occurrences = expandCalendarEvent({
      ...EVENT,
      recurrence: {
        frequency: 'weekly',
        interval: 2,
        weekdays: [2, 4],
        excludedDates: [],
        end: { type: 'after', count: 5 }
      }
    }, '2026-08-01', '2026-10-01')

    expect(occurrences.map((occurrence) => occurrence.startDate)).toEqual([
      '2026-08-18',
      '2026-08-20',
      '2026-09-01',
      '2026-09-03',
      '2026-09-15'
    ])
  })

  it('keeps a series duration when expanding recurring events', () => {
    const occurrences = expandCalendarEvent({
      ...EVENT,
      startDate: '2026-08-18',
      endDate: '2026-08-19',
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], excludedDates: [], end: { type: 'after', count: 2 } }
    }, '2026-08-18', '2026-08-22')

    expect(occurrences.map((occurrence) => [occurrence.startDate, occurrence.endDate])).toEqual([
      ['2026-08-18', '2026-08-19'],
      ['2026-08-19', '2026-08-20']
    ])
  })

  it('persists an occurrence exclusion without extending a count-limited series', () => {
    const series = {
      ...EVENT,
      recurrence: { frequency: 'daily' as const, interval: 1, weekdays: [], excludedDates: [], end: { type: 'after' as const, count: 3 } }
    }
    const occurrence = calendarEventForOccurrence(series, '2026-08-19')
    const excluded = excludeCalendarOccurrence(series, '2026-08-19', '2026-08-20T10:00:00.000Z')

    expect(occurrence).toMatchObject({ startDate: '2026-08-19', endDate: '2026-08-19' })
    expect(expandCalendarEvent(excluded, '2026-08-18', '2026-08-25').map((item) => item.startDate)).toEqual([
      '2026-08-18',
      '2026-08-20'
    ])
  })

  it('shifts an event through the same runtime validation used by IPC', () => {
    const shifted = shiftCalendarEvent(
      EVENT,
      '2026-08-19',
      '13:15',
      '2026-08-19',
      '14:45',
      '2026-08-19T20:00:00.000Z'
    )
    expect(shifted).toMatchObject({
      startDate: '2026-08-19',
      startTime: '13:15',
      endDate: '2026-08-19',
      endTime: '14:45'
    })
  })

  it('formats the operating-system local date without UTC rollover', () => {
    const local = new Date(2026, 7, 20, 23, 50)
    expect(calendarLocalDate(local)).toBe('2026-08-20')
  })

  it('converts event wall time between IANA zones without changing the instant', () => {
    expect(calendarWallTimeToInstant('2026-08-22', '09:00', 'America/Los_Angeles').toISOString()).toBe('2026-08-22T16:00:00.000Z')
    expect(convertCalendarWallTime('2026-08-22', '09:00', 'America/Los_Angeles', 'America/New_York')).toEqual({
      date: '2026-08-22',
      time: '12:00'
    })
    expect(convertCalendarWallTime('2026-08-22', '09:00', 'America/Los_Angeles', 'Asia/Tokyo')).toEqual({
      date: '2026-08-23',
      time: '01:00'
    })
  })

  it('rejects a wall time skipped by daylight saving time', () => {
    expect(() => calendarWallTimeToInstant('2026-03-08', '02:30', 'America/Los_Angeles')).toThrow(/does not exist/)
  })

  it('reads FullCalendar UTC grid values without operating-system rollover', () => {
    const gridValue = new Date('2026-08-22T23:45:00.000Z')
    expect(calendarGridDate(gridValue)).toBe('2026-08-22')
    expect(calendarGridTime(gridValue)).toBe('23:45')
  })
})
