import type { CalendarDayEvent } from './calendar'

/** A synced Google event row as stored in `calendar_events`. */
export interface StoredCalendarEvent {
  id: string
  account_id: string
  calendar_id: string
  title: string
  starts_at: string | null
  ends_at: string | null
  start_date: string | null
  end_date: string | null
  all_day: boolean
}

function localDateTime(instant: string, timezone: string): { date: string; time: string } {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
  return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}` }
}

/** Project one stored event onto the requested account-local days; midnight ends exclusively and multi-day events split per day. */
export function calendarDays(event: StoredCalendarEvent, dates: readonly string[], timezone: string, color: string | null): CalendarDayEvent[] {
  const base = { id: event.id, accountId: event.account_id, calendarId: event.calendar_id, title: event.title, color }
  if (event.all_day) {
    if (event.start_date === null || event.end_date === null) throw new Error(`All-day event ${event.id} has no date range`)
    const startDate = event.start_date, endDate = event.end_date
    return dates.filter((date) => date >= startDate && date < endDate).map((date) => ({ ...base, date, start: '00:00', end: '24:00', allDay: true }))
  }
  if (event.starts_at === null || event.ends_at === null) throw new Error(`Event ${event.id} has no time range`)
  const start = localDateTime(event.starts_at, timezone), end = localDateTime(event.ends_at, timezone)
  return dates
    .filter((date) => date >= start.date && date <= end.date && !(date === end.date && end.time === '00:00'))
    .map((date) => ({ ...base, date, start: date === start.date ? start.time : '00:00', end: date === end.date ? end.time : '24:00', allDay: false }))
}
