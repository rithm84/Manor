/**
 * Pure date and layout helpers for the calendar page. All dates are local
 * ISO strings ('YYYY-MM-DD'); times are 24h 'HH:MM' per data/mock.ts.
 */

import type { CalendarEvent } from '../../data/mock'

export const parseIso = (iso: string): Date => {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const toIso = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export const addDays = (iso: string, days: number): string => {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

export const addMonths = (iso: string, months: number): string => {
  const date = parseIso(iso)
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  return toIso(date)
}

/**
 * The canonical story's weekday anchor: in the mock world, 2026-08-18 is a
 * Monday (so today, 2026-08-20, is a Wednesday). All weekday derivation
 * offsets from this anchor; never Date.getDay(), which would leak the
 * real-world calendar into the fiction.
 */
const CANON_MONDAY = new Date(2026, 7, 18)
const MS_PER_DAY = 86_400_000

/** Canon weekday index: 0 = Monday .. 6 = Sunday. */
const canonWeekday = (iso: string): number => {
  const days = Math.round((parseIso(iso).getTime() - CANON_MONDAY.getTime()) / MS_PER_DAY)
  return ((days % 7) + 7) % 7
}

/** Monday-start week containing the given date. */
export const startOfWeek = (iso: string): string => {
  return addDays(iso, -canonWeekday(iso))
}

export const weekDays = (iso: string): readonly string[] => {
  const monday = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

/** Monday-first, indexed by canon weekday. */
const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const monthTitle = (iso: string): string => {
  const date = parseIso(iso)
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export const dayHeading = (iso: string): { weekday: string; day: number } => {
  return { weekday: WEEKDAYS_SHORT[canonWeekday(iso)], day: parseIso(iso).getDate() }
}

/** Full label for the event panel, e.g. "Wed, Aug 20". */
export const panelDateLabel = (iso: string): string => {
  const date = parseIso(iso)
  return `${WEEKDAYS_SHORT[canonWeekday(iso)]}, ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`
}

export const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** '14:00' -> '2:00 PM', '09:30' -> '9:30 AM'. */
export const formatTime = (time: string): string => {
  const [hours, minutes] = time.split(':').map(Number)
  const meridiem = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${String(minutes).padStart(2, '0')} ${meridiem}`
}

/** Gutter label, e.g. 9 -> '9 AM'. Skips midnight. */
export const formatHour = (hour: number): string => {
  if (hour === 0 || hour === 24) {
    return ''
  }
  if (hour === 12) {
    return 'Noon'
  }
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

export interface PositionedEvent {
  event: CalendarEvent
  /** Column index within its overlap cluster. */
  column: number
  /** Total columns in the cluster. */
  columns: number
}

/**
 * Side-by-side layout for overlapping events in one day column
 * (Cron-style split). Clusters are connected components of the overlap
 * relation; columns are assigned greedily by start time.
 */
export const layoutDay = (dayEvents: readonly CalendarEvent[]): readonly PositionedEvent[] => {
  const sorted = [...dayEvents].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const positioned: PositionedEvent[] = []
  let cluster: CalendarEvent[] = []
  let clusterEnd = -1

  const flush = (): void => {
    const columnEnds: number[] = []
    const placed = cluster.map((event) => {
      let column = columnEnds.findIndex((end) => end <= toMinutes(event.start))
      if (column === -1) {
        column = columnEnds.length
        columnEnds.push(0)
      }
      columnEnds[column] = toMinutes(event.end)
      return { event, column, columns: 0 }
    })
    for (const item of placed) {
      item.columns = columnEnds.length
      positioned.push(item)
    }
    cluster = []
    clusterEnd = -1
  }

  for (const event of sorted) {
    if (cluster.length > 0 && toMinutes(event.start) >= clusterEnd) {
      flush()
    }
    cluster.push(event)
    clusterEnd = Math.max(clusterEnd, toMinutes(event.end))
  }
  if (cluster.length > 0) {
    flush()
  }
  return positioned
}

/** Cells for a Monday-start month grid covering the month of `iso`. */
export interface MonthCell {
  iso: string
  day: number
  inMonth: boolean
}

export const monthCells = (iso: string): readonly MonthCell[] => {
  const anchor = parseIso(iso)
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = startOfWeek(toIso(first))
  const cells: MonthCell[] = []
  for (let i = 0; i < 42; i += 1) {
    const cellIso = addDays(start, i)
    const cellDate = parseIso(cellIso)
    cells.push({
      iso: cellIso,
      day: cellDate.getDate(),
      inMonth: cellDate.getMonth() === anchor.getMonth()
    })
  }
  return cells
}
