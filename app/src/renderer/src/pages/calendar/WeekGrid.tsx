import { useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { NOW_TIME, TODAY_ISO, calendars } from '../../data/mock'
import type { CalendarEvent } from '../../data/mock'
import { dayHeading, formatHour, formatTime, layoutDay, toMinutes } from './calendarModel'

export const HOUR_HEIGHT = 52

const calendarColor = (id: CalendarEvent['calendarId']): string => {
  const source = calendars.find((calendar) => calendar.id === id)
  return source !== undefined ? source.color : '#6c6a64'
}

export interface AllDayItem {
  id: string
  date: string
  label: string
}

export interface WeekGridProps {
  /** Columns to render (7 for week view, 1 for day view). */
  days: readonly string[]
  events: readonly CalendarEvent[]
  allDayItems: readonly AllDayItem[]
  selectedId: string | null
  onSelectEvent: (id: string) => void
  onSelectAllDay: (id: string) => void
  /** Click on an empty slot drops a one-hour scratch block there. */
  onCreateBlock: (date: string, hour: number) => void
}

/**
 * The Cron-anatomy time grid: day headers, all-day row, hour gutter,
 * absolute-positioned event chips with overlap splitting, dashed scratch
 * blocks, and the now line on today.
 */
export function WeekGrid({
  days,
  events,
  allDayItems,
  selectedId,
  onSelectEvent,
  onSelectAllDay,
  onCreateBlock
}: WeekGridProps): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollRef.current !== null) {
      // Open on the working day, roughly 6 AM at the top edge.
      scrollRef.current.scrollTop = HOUR_HEIGHT * 6 - 10
    }
  }, [])

  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  const nowOffset = (toMinutes(NOW_TIME) / 60) * HOUR_HEIGHT
  const showNow = days.includes(TODAY_ISO)

  const onColumnClick = (event: MouseEvent<HTMLDivElement>, date: string): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const hour = Math.floor((event.clientY - bounds.top) / HOUR_HEIGHT)
    onCreateBlock(date, Math.min(23, Math.max(0, hour)))
  }

  return (
    <div className="cal-grid">
      <div className="cal-grid-head">
        <div className="cal-gutter-spacer" />
        {days.map((iso) => {
          const heading = dayHeading(iso)
          const today = iso === TODAY_ISO
          return (
            <div key={iso} className="cal-day-head">
              <span className="cal-day-head-weekday">{heading.weekday}</span>
              <span className={`cal-day-head-num tnum${today ? ' is-today' : ''}`}>
                {heading.day}
              </span>
            </div>
          )
        })}
      </div>

      <div className="cal-allday">
        <div className="cal-gutter-spacer cal-allday-label">All day</div>
        {days.map((iso) => (
          <div key={iso} className="cal-allday-cell">
            {allDayItems
              .filter((item) => item.date === iso)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cal-allday-chip${selectedId === item.id ? ' is-selected' : ''}`}
                  onClick={() => onSelectAllDay(item.id)}
                >
                  {item.label}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="cal-grid-scroll" ref={scrollRef}>
        <div className="cal-grid-body" style={{ height: HOUR_HEIGHT * 24 }}>
          <div className="cal-gutter">
            {hours.map((hour) =>
              hour === 0 ? (
                <div key={hour} className="cal-gutter-hour" />
              ) : (
                <div key={hour} className="cal-gutter-hour" style={{ top: hour * HOUR_HEIGHT }}>
                  {formatHour(hour)}
                </div>
              )
            )}
            {showNow ? (
              <span className="cal-now-chip tnum" style={{ top: nowOffset }}>
                {formatTime(NOW_TIME)}
              </span>
            ) : null}
          </div>
          {days.map((iso) => {
            const positioned = layoutDay(events.filter((event) => event.date === iso))
            return (
              <div
                key={iso}
                className="cal-day-col"
                onClick={(clickEvent) => onColumnClick(clickEvent, iso)}
              >
                {hours.slice(1).map((hour) => (
                  <div
                    key={hour}
                    className="cal-hour-line"
                    style={{ top: hour * HOUR_HEIGHT }}
                    aria-hidden="true"
                  />
                ))}
                {positioned.map(({ event, column, columns }) => {
                  const top = (toMinutes(event.start) / 60) * HOUR_HEIGHT
                  const height = Math.max(
                    22,
                    ((toMinutes(event.end) - toMinutes(event.start)) / 60) * HOUR_HEIGHT - 2
                  )
                  const width = 100 / columns
                  const color = calendarColor(event.calendarId)
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`cal-event${event.scratch ? ' cal-event--scratch' : ''}${
                        event.faded ? ' is-faded' : ''
                      }${selectedId === event.id ? ' is-selected' : ''}`}
                      style={{
                        top,
                        height,
                        left: `calc(${column * width}% + 2px)`,
                        width: `calc(${width}% - 5px)`,
                        ['--event-color' as string]: color
                      }}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation()
                        onSelectEvent(event.id)
                      }}
                    >
                      <span className="cal-event-title">{event.title}</span>
                      {height >= 40 ? (
                        <span className="cal-event-time">{formatTime(event.start)}</span>
                      ) : null}
                    </button>
                  )
                })}
                {iso === TODAY_ISO ? (
                  <div className="cal-nowline" style={{ top: nowOffset }} aria-hidden="true" />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
