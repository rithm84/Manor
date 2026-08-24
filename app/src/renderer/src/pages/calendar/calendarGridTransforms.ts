import {
  calendarGridDate,
  calendarGridTime,
  calendarWallTimeInZone,
  calendarWallTimeToInstant,
  convertCalendarWallTime,
  shiftCalendarEvent
} from '../../../../shared/calendar'
import type { CalendarEventRecord } from '../../../../shared/calendar'

function requiredEventTime(value: string | null, label: string): string {
  if (value === null) throw new TypeError(`Timed calendar event is missing its ${label}`)
  return value
}

function storedWallTimeFromGrid(value: Date, primaryTimeZone: string, eventTimeZone: string): { date: string; time: string } {
  const gridDate = calendarGridDate(value)
  const gridTime = calendarGridTime(value)
  const instant = calendarWallTimeToInstant(gridDate, gridTime, primaryTimeZone)
  return calendarWallTimeInZone(instant, eventTimeZone)
}

function gridDateForWallTime(date: string, time: string, eventTimeZone: string, primaryTimeZone: string): Date {
  const primary = convertCalendarWallTime(date, time, eventTimeZone, primaryTimeZone)
  return new Date(`${primary.date}T${primary.time}:00.000Z`)
}

export function shiftedCalendarGridEvent(
  record: CalendarEventRecord,
  oldStart: Date,
  nextStart: Date,
  nextEnd: Date | null,
  primaryTimeZone: string,
  updatedAt: string
): CalendarEventRecord {
  if (record.recurrence === null) {
    const fallbackEnd = nextEnd ?? new Date(nextStart.getTime() + 60 * 60 * 1000)
    if (record.allDay) {
      return shiftCalendarEvent(record, calendarGridDate(nextStart), null, calendarGridDate(fallbackEnd), null, updatedAt)
    }
    const movedStart = storedWallTimeFromGrid(nextStart, primaryTimeZone, record.timeZone)
    const movedEnd = storedWallTimeFromGrid(fallbackEnd, primaryTimeZone, record.timeZone)
    return shiftCalendarEvent(record, movedStart.date, movedStart.time, movedEnd.date, movedEnd.time, updatedAt)
  }

  const delta = nextStart.getTime() - oldStart.getTime()
  const baseStart = record.allDay
    ? new Date(`${record.startDate}T00:00:00.000Z`)
    : gridDateForWallTime(record.startDate, requiredEventTime(record.startTime, 'start time'), record.timeZone, primaryTimeZone)
  const baseEnd = record.allDay
    ? new Date(`${record.endDate}T00:00:00.000Z`)
    : gridDateForWallTime(record.endDate, requiredEventTime(record.endTime, 'end time'), record.timeZone, primaryTimeZone)
  const movedStart = new Date(baseStart.getTime() + delta)
  const duration = nextEnd === null ? baseEnd.getTime() - baseStart.getTime() : nextEnd.getTime() - nextStart.getTime()
  const movedEnd = new Date(movedStart.getTime() + duration)
  if (record.allDay) {
    return shiftCalendarEvent(record, calendarGridDate(movedStart), null, calendarGridDate(movedEnd), null, updatedAt)
  }
  const storedStart = storedWallTimeFromGrid(movedStart, primaryTimeZone, record.timeZone)
  const storedEnd = storedWallTimeFromGrid(movedEnd, primaryTimeZone, record.timeZone)
  return shiftCalendarEvent(record, storedStart.date, storedStart.time, storedEnd.date, storedEnd.time, updatedAt)
}

export function shiftOccurrenceFromCalendarGrid(
  occurrence: CalendarEventRecord,
  nextStart: Date,
  nextEnd: Date | null,
  primaryTimeZone: string,
  updatedAt: string
): CalendarEventRecord {
  const fallbackEnd = nextEnd ?? new Date(nextStart.getTime() + 60 * 60 * 1000)
  if (occurrence.allDay) {
    return shiftCalendarEvent(occurrence, calendarGridDate(nextStart), null, calendarGridDate(fallbackEnd), null, updatedAt)
  }
  const storedStart = storedWallTimeFromGrid(nextStart, primaryTimeZone, occurrence.timeZone)
  const storedEnd = storedWallTimeFromGrid(fallbackEnd, primaryTimeZone, occurrence.timeZone)
  return shiftCalendarEvent(occurrence, storedStart.date, storedStart.time, storedEnd.date, storedEnd.time, updatedAt)
}
