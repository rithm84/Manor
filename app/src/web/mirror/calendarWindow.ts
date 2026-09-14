import type { JsonObject } from '../ManorGateway'

/**
 * The span a calendar read covers. All-day rows are compared as dates because they carry no zone, and
 * timed rows are compared as instants over a span widened by a day on each side, which is enough to catch
 * every event that touches one of the requested account-local days in any time zone.
 */
export interface CalendarWindow {
  readonly firstDate: string
  readonly lastDate: string
  readonly earliest: string
  readonly latest: string
  readonly earliestMs: number
  readonly latestMs: number
}

export function calendarWindow(ordered: readonly string[]): CalendarWindow {
  if (ordered.length === 0) throw new RangeError('A calendar window covers at least one day')
  const firstDate = ordered[0]
  const lastDate = ordered[ordered.length - 1]
  const earliest = new Date(`${firstDate}T00:00:00Z`)
  earliest.setUTCDate(earliest.getUTCDate() - 1)
  const latest = new Date(`${lastDate}T00:00:00Z`)
  latest.setUTCDate(latest.getUTCDate() + 2)
  return {
    firstDate, lastDate,
    earliest: earliest.toISOString(), latest: latest.toISOString(),
    earliestMs: earliest.getTime(), latestMs: latest.getTime()
  }
}

/** The server-side form of the window, as one PostgREST `or` expression over `calendar_events`. */
export function calendarWindowFilter(window: CalendarWindow): string {
  return `and(all_day.eq.true,start_date.lte.${window.lastDate},end_date.gt.${window.firstDate}),` +
    `and(all_day.eq.false,starts_at.lt.${window.latest},ends_at.gt.${window.earliest})`
}

/** The local form of the same window, applied to a stored `calendar_events` row from the mirror. */
export function withinCalendarWindow(row: JsonObject, window: CalendarWindow): boolean {
  if (row.all_day === true) {
    const { start_date: startDate, end_date: endDate } = row
    return typeof startDate === 'string' && typeof endDate === 'string' && startDate <= window.lastDate && endDate > window.firstDate
  }
  if (row.all_day !== false) return false
  const { starts_at: startsAt, ends_at: endsAt } = row
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') return false
  return Date.parse(startsAt) < window.latestMs && Date.parse(endsAt) > window.earliestMs
}
