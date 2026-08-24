import dayGridPlugin from '@fullcalendar/daygrid'
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput
} from '@fullcalendar/core'
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { forwardRef, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { calendarGridDate, calendarGridTime, calendarWallTimeInZone, calendarWallTimeToInstant } from '../../../../shared/calendar'
import type { CalendarSettings } from '../../../../shared/calendar'

export type CalendarWorkspaceView = 'day' | 'week' | 'month'

export function calendarGridViewName(view: CalendarWorkspaceView): string {
  if (view === 'day') return 'timeGridDay'
  if (view === 'week') return 'timeGridContinuousWeek'
  return 'dayGridMonth'
}

export interface CalendarGridProps {
  view: CalendarWorkspaceView
  events: readonly EventInput[]
  settings: CalendarSettings
  hourHeight: number
  allDayVisible: boolean
  onSelect: (selection: DateSelectArg) => void
  onEventClick: (event: EventClickArg) => void
  onEventContextMenu: (event: EventClickArg, point: { x: number; y: number }) => void
  onEventDrop: (event: EventDropArg) => void
  onEventResize: (event: EventResizeDoneArg) => void
  onDatesSet: (dates: DatesSetArg) => void
}

function formatSecondaryTime(date: Date, settings: CalendarSettings): string | null {
  if (settings.secondaryTimeZone === null) return null
  const instant = calendarWallTimeToInstant(calendarGridDate(date), calendarGridTime(date), settings.primaryTimeZone)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: settings.secondaryTimeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: settings.timeFormat === '12h'
  }).format(instant)
}

function currentGridTime(timeZone: string): string {
  const current = calendarWallTimeInZone(new Date(), timeZone)
  return `${current.date}T${current.time}:00.000Z`
}

function CalendarEventContent({ event, timeText }: EventContentArg): ReactNode {
  return (
    <div className="cal-event-content" data-calendar-item-id={event.id}>
      {timeText === '' ? null : <time>{timeText}</time>}
      <strong>{event.title}</strong>
    </div>
  )
}

export const CalendarGrid = forwardRef<FullCalendar, CalendarGridProps>(function CalendarGrid({
  view,
  events,
  settings,
  hourHeight,
  allDayVisible,
  onSelect,
  onEventClick,
  onEventContextMenu,
  onEventDrop,
  onEventResize,
  onDatesSet
}, ref): ReactNode {
  const viewName = calendarGridViewName(view)
  const [now, setNow] = useState(() => currentGridTime(settings.primaryTimeZone))

  useEffect(() => {
    setNow(currentGridTime(settings.primaryTimeZone))
    const timer = window.setInterval(() => setNow(currentGridTime(settings.primaryTimeZone)), 60_000)
    return () => window.clearInterval(timer)
  }, [settings.primaryTimeZone])

  return (
    <div className={`cal-grid${view === 'week' ? ' is-continuous-week' : ''}`} style={{ '--calendar-hour-height': `${hourHeight}px` } as React.CSSProperties}>
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={viewName}
        timeZone="UTC"
        now={now}
        headerToolbar={false}
        height="100%"
        nowIndicator
        selectable
        selectMirror
        unselectAuto={false}
        editable
        eventStartEditable
        eventDurationEditable
        eventResizableFromStart
        eventOverlap
        selectOverlap
        weekends={settings.showWeekends}
        firstDay={settings.weekStart === 'monday' ? 1 : 0}
        allDaySlot={allDayVisible}
        allDayText="All day"
        businessHours={{
          daysOfWeek: settings.showWeekends ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
          startTime: settings.workingHoursStart,
          endTime: settings.workingHoursEnd
        }}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime={settings.workingHoursStart}
        scrollTimeReset={false}
        slotDuration="00:30:00"
        snapDuration="00:15:00"
        slotLabelInterval="01:00:00"
        slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.timeFormat === '12h' }}
        views={{
          dayGridMonth: { dayHeaderFormat: { weekday: 'short' } },
          timeGridContinuousWeek: {
            type: 'timeGrid',
            duration: { days: 14 },
            dateAlignment: 'week',
            dayHeaderFormat: { weekday: 'short', month: 'short', day: 'numeric' }
          },
          timeGridDay: { dayHeaderFormat: { weekday: 'long', month: 'short', day: 'numeric' } }
        }}
        eventDisplay="block"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.timeFormat === '12h' }}
        dayMaxEvents={4}
        stickyHeaderDates
        expandRows={false}
        events={[...events]}
        eventAllow={(_dropInfo, draggedEvent) => draggedEvent !== null && draggedEvent.extendedProps.kind === 'event'}
        eventContent={(content) => <CalendarEventContent {...content} />}
        slotLabelContent={(content) => {
          const secondary = formatSecondaryTime(content.date, settings)
          return (
            <span className="cal-slot-label">
              <span>{content.text}</span>
              {secondary === null ? null : <small>{secondary}</small>}
            </span>
          )
        }}
        select={onSelect}
        eventClick={onEventClick}
        eventDrop={onEventDrop}
        eventResize={onEventResize}
        datesSet={onDatesSet}
        eventDidMount={(mount) => {
          mount.el.oncontextmenu = (event) => {
            event.preventDefault()
            onEventContextMenu({ el: mount.el, event: mount.event, jsEvent: event, view: mount.view }, { x: event.clientX, y: event.clientY })
          }
        }}
        eventWillUnmount={(mount) => { mount.el.oncontextmenu = null }}
      />
    </div>
  )
})
