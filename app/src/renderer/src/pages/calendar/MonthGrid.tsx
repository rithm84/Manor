import type { ReactNode } from 'react'

import { TODAY_ISO, calendars } from '../../data/mock'
import type { CalendarEvent } from '../../data/mock'
import { monthCells, toMinutes } from './calendarModel'

const WEEKDAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MAX_CHIPS = 3

const calendarColor = (id: CalendarEvent['calendarId']): string => {
  const source = calendars.find((calendar) => calendar.id === id)
  return source !== undefined ? source.color : '#6c6a64'
}

export interface MonthGridProps {
  anchor: string
  events: readonly CalendarEvent[]
  selectedId: string | null
  onSelectEvent: (id: string) => void
  onOpenDay: (iso: string) => void
}

/** Month view: six weeks of compact day cells with small event chips. */
export function MonthGrid({
  anchor,
  events,
  selectedId,
  onSelectEvent,
  onOpenDay
}: MonthGridProps): ReactNode {
  const cells = monthCells(anchor)

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {WEEKDAY_HEADS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="cal-month-body">
        {cells.map((cell) => {
          const dayEvents = [...events]
            .filter((event) => event.date === cell.iso)
            .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
          const overflow = dayEvents.length - MAX_CHIPS
          return (
            <div
              key={cell.iso}
              className={`cal-month-cell${cell.inMonth ? '' : ' is-outside'}`}
              onClick={() => onOpenDay(cell.iso)}
            >
              <span className={`cal-month-daynum tnum${cell.iso === TODAY_ISO ? ' is-today' : ''}`}>
                {cell.day}
              </span>
              {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`cal-month-chip${event.scratch ? ' cal-month-chip--scratch' : ''}${
                    event.faded ? ' is-faded' : ''
                  }${selectedId === event.id ? ' is-selected' : ''}`}
                  style={{ ['--event-color' as string]: calendarColor(event.calendarId) }}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation()
                    onSelectEvent(event.id)
                  }}
                >
                  {event.title}
                </button>
              ))}
              {overflow > 0 ? <span className="cal-month-more tnum">{overflow} more</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
