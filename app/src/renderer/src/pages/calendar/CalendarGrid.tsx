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
import { forwardRef, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { calendarGridDate, calendarGridTime, calendarWallTimeInZone, calendarWallTimeToInstant } from '../../../../shared/calendar'
import type { CalendarSettings } from '../../../../shared/calendar'

export type CalendarWorkspaceView = 'day' | 'week' | 'month'

export function calendarGridViewName(view: CalendarWorkspaceView): string {
  if (view === 'day') return 'timeGridDay'
  if (view === 'week') return 'timeGridWeek'
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

function CalendarEventContent({ event, timeText, view }: EventContentArg): ReactNode {
  if (view.type === 'dayGridMonth' && !event.allDay) {
    return (
      <div className="cal-event-content cal-event-content--row" data-calendar-item-id={event.id}>
        <i className="cal-event-dot" style={{ background: event.borderColor }} aria-hidden="true" />
        {timeText === '' ? null : <time>{timeText}</time>}
        <strong>{event.title}</strong>
      </div>
    )
  }
  return (
    <div className="cal-event-content" data-calendar-item-id={event.id}>
      {timeText === '' ? null : <time>{timeText}</time>}
      <strong>{event.title}</strong>
    </div>
  )
}

const DAY_HEAD_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })

function CalendarDayHeader({ date, view, isToday, text }: { date: Date; view: { type: string }; isToday: boolean; text: string }): ReactNode {
  if (view.type === 'dayGridMonth') return <>{text}</>
  return (
    <span className={`cal-day-head${isToday ? ' is-today' : ''}`}>
      <span className="cal-day-head-name">{DAY_HEAD_WEEKDAY.format(date)}</span>
      <span className="cal-day-head-num tnum">{date.getUTCDate()}</span>
    </span>
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
  const gridRef = useRef<HTMLDivElement | null>(null)
  const calendarRef = useRef<FullCalendar | null>(null)
  const panAccum = useRef(0)
  const panResetTimer = useRef<number | null>(null)

  const assignRefs = (instance: FullCalendar | null): void => {
    calendarRef.current = instance
    if (typeof ref === 'function') ref(instance)
    else if (ref !== null) ref.current = instance
  }

  useEffect(() => {
    setNow(currentGridTime(settings.primaryTimeZone))
    const timer = window.setInterval(() => setNow(currentGridTime(settings.primaryTimeZone)), 60_000)
    return () => window.clearInterval(timer)
  }, [settings.primaryTimeZone])

  /* Trackpad horizontal panning navigates the grid, as in Notion Calendar.
     Day view slides a day per step; week and month step a full period. */
  useEffect(() => {
    const element = gridRef.current
    if (element === null) return
    const threshold = view === 'day' ? 110 : view === 'week' ? 240 : 280
    const moveBy = (direction: 1 | -1): void => {
      const api = calendarRef.current?.getApi()
      if (api === undefined) return
      if (view === 'month') {
        if (direction === 1) api.next()
        else api.prev()
        return
      }
      api.incrementDate({ days: direction * (view === 'week' ? 7 : 1) })
    }
    const onWheel = (event: WheelEvent): void => {
      const horizontalDelta = event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX
      if (Math.abs(horizontalDelta) <= Math.abs(event.deltaY) && !event.shiftKey) return
      event.preventDefault()
      panAccum.current += horizontalDelta
      while (panAccum.current >= threshold) {
        panAccum.current -= threshold
        moveBy(1)
      }
      while (panAccum.current <= -threshold) {
        panAccum.current += threshold
        moveBy(-1)
      }
      if (panResetTimer.current !== null) window.clearTimeout(panResetTimer.current)
      panResetTimer.current = window.setTimeout(() => { panAccum.current = 0 }, 300)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      if (panResetTimer.current !== null) window.clearTimeout(panResetTimer.current)
    }
  }, [view])

  return (
    <div ref={gridRef} className="cal-grid" style={{ '--calendar-hour-height': `${hourHeight}px` } as React.CSSProperties}>
      <FullCalendar
        ref={assignRefs}
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
          timeGridWeek: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } },
          timeGridDay: { dayHeaderFormat: { weekday: 'short', day: 'numeric' } }
        }}
        dayHeaderContent={(header) => (
          <CalendarDayHeader date={header.date} view={header.view} isToday={header.isToday} text={header.text} />
        )}
        eventDisplay="auto"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: 'short', hour12: settings.timeFormat === '12h' }}
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
