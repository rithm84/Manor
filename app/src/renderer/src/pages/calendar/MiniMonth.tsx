import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { addCalendarDays, calendarWallTimeInZone } from '../../../../shared/calendar'
import type { CalendarWeekStart } from '../../../../shared/calendar'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month: month - 1, day }
}

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

function monthShift(isoDate: string, amount: number): string {
  const value = parts(isoDate)
  return iso(value.year, value.month + amount, 1)
}

function monthCells(anchor: string, weekStart: CalendarWeekStart): readonly string[] {
  const value = parts(anchor)
  const first = iso(value.year, value.month, 1)
  const firstWeekday = new Date(`${first}T00:00:00.000Z`).getUTCDay()
  const offset = weekStart === 'monday' ? (firstWeekday + 6) % 7 : firstWeekday
  const start = addCalendarDays(first, -offset)
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index))
}

export interface MiniMonthProps {
  anchor: string
  weekStart: CalendarWeekStart
  primaryTimeZone: string
  onPickDay: (iso: string) => void
}

export function MiniMonth({ anchor, weekStart, primaryTimeZone, onPickDay }: MiniMonthProps): ReactNode {
  const [shown, setShown] = useState(anchor)
  const today = calendarWallTimeInZone(new Date(), primaryTimeZone).date
  const anchorParts = parts(shown)
  const cells = monthCells(shown, weekStart)
  const labels = weekStart === 'monday'
    ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  useEffect(() => setShown(anchor), [anchor])

  return (
    <section className="cal-mini" aria-label="Jump to date">
      <header className="cal-mini-head">
        <span className="cal-mini-title">{MONTHS[anchorParts.month]} {anchorParts.year}</span>
        <span className="cal-mini-nav">
          <button type="button" className="cal-icon-btn" onClick={() => setShown(monthShift(shown, -1))} aria-label="Previous month">
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="cal-icon-btn" onClick={() => setShown(monthShift(shown, 1))} aria-label="Next month">
            <ChevronRight size={14} />
          </button>
        </span>
      </header>
      <div className="cal-mini-weekdays" aria-hidden="true">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="cal-mini-days">
        {cells.map((date) => {
          const cell = parts(date)
          const outside = cell.month !== anchorParts.month
          return (
            <button
              key={date}
              type="button"
              className={`cal-mini-day${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${date === anchor ? ' is-anchor' : ''}`}
              onClick={() => onPickDay(date)}
              aria-label={date}
              aria-current={date === today ? 'date' : undefined}
            >
              {cell.day}
            </button>
          )
        })}
      </div>
    </section>
  )
}
