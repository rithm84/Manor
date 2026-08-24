import type { DateSelectArg, DatesSetArg, EventClickArg, EventDropArg } from '@fullcalendar/core'
import type FullCalendar from '@fullcalendar/react'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, HelpCircle, Minus, PanelTopClose, Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { addCalendarDays, calendarEventForOccurrence, calendarGridDate, calendarGridTime, calendarLocalDate, calendarWallTimeInZone, excludeCalendarOccurrence, parseCalendarEvent } from '../../../shared/calendar'
import type { CalendarDefinition, CalendarEventRecord, CalendarSettings, CalendarState } from '../../../shared/calendar'
import type { HomeState } from '../../../shared/home'
import type { JobsState } from '../../../shared/jobs'
import type { NotesState } from '../../../shared/notes'
import { Button, QuickActionsMenu, Select } from '../components/ui'
import type { QuickActionItem } from '../components/ui'
import { CalendarEditorDialog } from './calendar/CalendarEditorDialog'
import { CalendarCommandMenu } from './calendar/CalendarCommandMenu'
import type { CalendarCommand } from './calendar/CalendarCommandMenu'
import { CalendarGrid, calendarGridViewName } from './calendar/CalendarGrid'
import type { CalendarWorkspaceView } from './calendar/CalendarGrid'
import { CalendarSettingsDialog } from './calendar/CalendarSettingsDialog'
import { CalendarShortcutsDialog } from './calendar/CalendarShortcutsDialog'
import { CalendarSidebar } from './calendar/CalendarSidebar'
import type { ManorOverlay } from './calendar/CalendarSidebar'
import type { CalendarUpcomingItem } from './calendar/CalendarSidebar'
import { EventDialog } from './calendar/EventDialog'
import type { EventEditScope } from './calendar/EventDialog'
import { LinkedCalendarDialog } from './calendar/LinkedCalendarDialog'
import { RecurringChangeDialog } from './calendar/RecurringChangeDialog'
import { jobOverlayInputs, persistedEventInputs, scratchOverlayInputs, taskOverlayInputs } from './calendar/calendarEvents'
import type { CalendarItemReference } from './calendar/calendarEvents'
import { shiftedCalendarGridEvent, shiftOccurrenceFromCalendarGrid } from './calendar/calendarGridTransforms'
import { createCalendarSeed } from './calendar/calendarSeed'
import { createHomeSeed } from './home/homeSeed'
import { createJobsSeed } from './jobs/jobsSeed'
import { notesSeed } from './notes/notesSeed'
import { PageShell } from './PageShell'
import './calendar/calendar.css'

const VIEWS: readonly { id: CalendarWorkspaceView; label: string }[] = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }
]

interface ContextMenuState {
  point: { x: number; y: number; source: 'pointer' }
  reference: CalendarItemReference
}

interface EventDialogState {
  event: CalendarEventRecord
  creating: boolean
  confirmDelete: boolean
  occurrenceDate: string | null
  occurrenceEvent: CalendarEventRecord | null
}

interface PendingRecurringChange {
  record: CalendarEventRecord
  occurrenceDate: string
  occurrenceEvent: CalendarEventRecord
  oldStart: Date
  nextStart: Date
  nextEnd: Date | null
  action: 'move' | 'resize'
}

function emptyEvent(calendarId: string, date: string, endDate: string, startTime: string | null, endTime: string | null, allDay: boolean, timeZone: string): CalendarEventRecord {
  const now = new Date().toISOString()
  return {
    id: `calendar-event-${crypto.randomUUID()}`, calendarId, title: '', eventType: 'event', allDay,
    startDate: date, endDate, startTime, endTime, timeZone, location: '', description: '', conferenceUrl: '',
    visibility: 'default', busyStatus: 'busy', reminders: [10], notePageIds: [], recurrence: null,
    recurrenceParentId: null, recurrenceOriginalDate: null, createdAt: now, updatedAt: now
  }
}

function dateFromInput(value: Date | null): string {
  if (value === null) throw new TypeError('Calendar selection did not include a date')
  return calendarGridDate(value)
}

function timeFromInput(value: Date | null): string {
  if (value === null) throw new TypeError('Calendar selection did not include a time')
  return calendarGridTime(value)
}

function calendarToolbarMonth(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return element !== null && (element.matches('input, textarea, select') || element.isContentEditable)
}

function occurrenceDateFor(reference: CalendarItemReference, record: CalendarEventRecord): string | null {
  if (record.recurrence === null) return null
  const prefix = `${record.id}::`
  return reference.occurrenceId.startsWith(prefix) ? reference.occurrenceId.slice(prefix.length) : null
}

function exceptionForOccurrence(event: CalendarEventRecord, seriesId: string, occurrenceDate: string): CalendarEventRecord {
  const now = new Date().toISOString()
  const existingException = event.recurrenceParentId === seriesId && event.recurrenceOriginalDate === occurrenceDate
  return parseCalendarEvent({
    ...event,
    id: existingException ? event.id : `calendar-event-${crypto.randomUUID()}`,
    recurrence: null,
    recurrenceParentId: seriesId,
    recurrenceOriginalDate: occurrenceDate,
    createdAt: now,
    updatedAt: now
  })
}

export function CalendarPage(): ReactNode {
  const navigate = useNavigate()
  const calendarRef = useRef<FullCalendar | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [calendarState, setCalendarState] = useState<CalendarState | null>(null)
  const [homeState, setHomeState] = useState<HomeState | null>(null)
  const [jobsState, setJobsState] = useState<JobsState | null>(null)
  const [notesState, setNotesState] = useState<NotesState | null>(null)
  const [view, setView] = useState<CalendarWorkspaceView>('week')
  const [anchor, setAnchor] = useState(calendarLocalDate(new Date()))
  const [range, setRange] = useState({ start: addCalendarDays(anchor, -45), end: addCalendarDays(anchor, 400) })
  const title = useMemo(() => calendarToolbarMonth(anchor), [anchor])
  const [search, setSearch] = useState('')
  const [overlays, setOverlays] = useState<ReadonlySet<ManorOverlay>>(new Set(['tasks', 'jobs', 'scratch']))
  const [hourHeight, setHourHeight] = useState(52)
  const [allDayVisible, setAllDayVisible] = useState(true)
  const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null)
  const [linkedReference, setLinkedReference] = useState<CalendarItemReference | null>(null)
  const [calendarDialog, setCalendarDialog] = useState<CalendarDefinition | 'new' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedOccurrenceDate, setSelectedOccurrenceDate] = useState<string | null>(null)
  const [selectedOccurrenceEvent, setSelectedOccurrenceEvent] = useState<CalendarEventRecord | null>(null)
  const [pendingRecurringChange, setPendingRecurringChange] = useState<PendingRecurringChange | null>(null)
  const [error, setError] = useState<string | null>(null)
  const primaryTimeZone = calendarState?.settings.primaryTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    let active = true
    Promise.all([window.manor.calendar.load(createCalendarSeed()), window.manor.home.load(createHomeSeed()), window.manor.jobs.load(createJobsSeed()), window.manor.notes.load(notesSeed)])
      .then(([calendar, home, jobs, notes]) => {
        if (!active) return
        setCalendarState(calendar); setHomeState(home); setJobsState(jobs); setNotesState(notes)
        setAnchor(calendarWallTimeInZone(new Date(), calendar.settings.primaryTimeZone).date)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Calendar data could not be loaded') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const api = calendarRef.current?.getApi()
    if (api === undefined) return
    const viewName = calendarGridViewName(view)
    if (api.view.type !== viewName) api.changeView(viewName, anchor)
  }, [anchor, view])

  const editableCalendars = useMemo(() => calendarState?.calendars.filter((calendar) => !calendar.readOnly) ?? [], [calendarState])
  const inputs = useMemo(() => {
    if (calendarState === null || homeState === null || jobsState === null) return []
    const combined = [
      ...persistedEventInputs(calendarState.events, calendarState.calendars, range.start, range.end, calendarState.settings.primaryTimeZone),
      ...(overlays.has('tasks') ? taskOverlayInputs(homeState.tasks, homeState.contexts) : []),
      ...(overlays.has('scratch') ? scratchOverlayInputs(homeState.scratchBlocks, homeState.tasks) : []),
      ...(overlays.has('jobs') ? jobOverlayInputs(jobsState.roles) : [])
    ]
    const query = search.trim().toLocaleLowerCase()
    return query === '' ? combined : combined.filter((event) => event.title?.toLocaleLowerCase().includes(query))
  }, [calendarState, homeState, jobsState, overlays, range, search])

  const upcoming = useMemo<readonly CalendarUpcomingItem[]>(() => {
    if (calendarState === null || homeState === null || jobsState === null) return []
    const today = calendarWallTimeInZone(new Date(), calendarState.settings.primaryTimeZone).date
    const horizon = addCalendarDays(today, 45)
    const combined = [
      ...persistedEventInputs(calendarState.events, calendarState.calendars, today, horizon, calendarState.settings.primaryTimeZone),
      ...(overlays.has('tasks') ? taskOverlayInputs(homeState.tasks, homeState.contexts) : []),
      ...(overlays.has('scratch') ? scratchOverlayInputs(homeState.scratchBlocks, homeState.tasks) : []),
      ...(overlays.has('jobs') ? jobOverlayInputs(jobsState.roles) : [])
    ]
    return combined.flatMap((event) => {
      if (typeof event.start !== 'string' || event.start.slice(0, 10) < today) return []
      return [{
        id: String(event.id),
        title: event.title ?? 'Untitled event',
        date: event.start.slice(0, 10),
        color: typeof event.borderColor === 'string' ? event.borderColor : '#6a6669',
        reference: event.extendedProps as CalendarItemReference
      }]
    }).sort((first, second) => first.date.localeCompare(second.date) || first.title.localeCompare(second.title)).slice(0, 5)
  }, [calendarState, homeState, jobsState, overlays])

  const updateCalendarState = useCallback(async (operation: () => Promise<CalendarState>): Promise<boolean> => {
    try { setError(null); setCalendarState(await operation()); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The calendar change could not be saved'); return false }
  }, [])

  const goToToday = useCallback((): void => {
    const today = calendarWallTimeInZone(new Date(), primaryTimeZone).date
    setAnchor(today)
    calendarRef.current?.getApi().gotoDate(`${today}T00:00:00.000Z`)
  }, [primaryTimeZone])

  const movePeriod = useCallback((direction: -1 | 1): void => {
    const api = calendarRef.current?.getApi()
    if (api === undefined) return
    if (view === 'month') {
      if (direction === -1) api.prev()
      else api.next()
      return
    }
    api.incrementDate({ days: view === 'week' ? direction * 7 : direction })
  }, [view])

  const openEventReference = useCallback((reference: CalendarItemReference): void => {
    if (reference.kind !== 'event') { setLinkedReference(reference); return }
    const record = calendarState?.events.find((event) => event.id === reference.sourceId) ?? null
    if (record !== null) {
      const parent = record.recurrenceParentId === null
        ? record
        : calendarState?.events.find((event) => event.id === record.recurrenceParentId) ?? null
      if (parent === null) { setError(`Recurring event ${record.title} is missing its parent series`); return }
      const occurrenceDate = record.recurrenceParentId === null ? occurrenceDateFor(reference, record) : record.recurrenceOriginalDate
      setSelectedEventId(parent.id)
      setSelectedOccurrenceDate(occurrenceDate)
      setSelectedOccurrenceEvent(record.recurrenceParentId === null ? null : record)
      setEventDialog({ event: parent, creating: false, confirmDelete: false, occurrenceDate, occurrenceEvent: record.recurrenceParentId === null ? null : record })
    }
  }, [calendarState])

  const createAt = useCallback((date: string, allDay: boolean, startTime: string | null, endTime: string | null, endDate: string): void => {
    const calendar = editableCalendars[0]
    if (calendar === undefined || calendarState === null) { setError('Create a local calendar before adding an event'); return }
    setEventDialog({ creating: true, confirmDelete: false, occurrenceDate: null, occurrenceEvent: null, event: emptyEvent(calendar.id, date, endDate, startTime, endTime, allDay, calendarState.settings.primaryTimeZone) })
  }, [calendarState, editableCalendars])
  const createDefaultEvent = useCallback(() => createAt(anchor, false, '09:00', '10:00', anchor), [anchor, createAt])

  const commands = useMemo<readonly CalendarCommand[]>(() => [
    { id: 'new-event', label: 'New event', group: 'Actions', icon: <CalendarPlus size={15} />, keys: ['C'], run: createDefaultEvent },
    { id: 'today', label: 'Go to today', group: 'Navigation', icon: <CalendarDays size={15} />, keys: ['T'], run: goToToday },
    ...VIEWS.map((option, index) => ({ id: `view-${option.id}`, label: `${option.label} view`, group: 'Views', icon: <CalendarDays size={15} />, keys: [String(index + 1)], run: () => setView(option.id) })),
    { id: 'settings', label: 'Calendar settings', group: 'Settings', icon: <Settings2 size={15} />, keys: null, run: () => setSettingsOpen(true) },
    ...(calendarState?.calendars.map((calendar) => ({
      id: `calendar-${calendar.id}`,
      label: `${calendar.visible ? 'Hide' : 'Show'} ${calendar.name}`,
      group: 'Calendars',
      icon: calendar.visible ? <EyeOff size={15} /> : <Eye size={15} />,
      keys: null,
      run: () => { void updateCalendarState(() => window.manor.calendar.upsertCalendar({ ...calendar, visible: !calendar.visible, updatedAt: new Date().toISOString() })) }
    })) ?? [])
  ], [calendarState, createDefaultEvent, goToToday, updateCalendarState])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); setCommandsOpen(true); return }
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const api = calendarRef.current?.getApi()
      if (api === undefined) return
      const key = event.key.toLocaleLowerCase()
      if (key === 't') { event.preventDefault(); goToToday() }
      else if (key === '1' || key === '2' || key === '3') { event.preventDefault(); setView(key === '1' ? 'day' : key === '2' ? 'week' : 'month') }
      else if (key === 'n') { event.preventDefault(); movePeriod(1) }
      else if (key === 'p') { event.preventDefault(); movePeriod(-1) }
      else if (key === 'c') { event.preventDefault(); createDefaultEvent() }
      else if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
      else if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true) }
      else if (event.key === 'Delete' && selectedEventId !== null) {
        const record = calendarState?.events.find((item) => item.id === selectedEventId)
        if (record !== undefined) { event.preventDefault(); setEventDialog({ event: record, creating: false, confirmDelete: true, occurrenceDate: selectedOccurrenceDate, occurrenceEvent: selectedOccurrenceEvent }) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [calendarState, createDefaultEvent, goToToday, movePeriod, selectedEventId, selectedOccurrenceDate, selectedOccurrenceEvent])

  if (calendarState === null || homeState === null || jobsState === null || notesState === null) return <PageShell title="Calendar" fullBleed><div className="cal-loading">{error ?? 'Loading calendar…'}</div></PageShell>

  const selectRange = (selection: DateSelectArg): void => {
    const startDate = dateFromInput(selection.start)
    if (selection.allDay) createAt(startDate, true, null, null, dateFromInput(selection.end))
    else createAt(startDate, false, timeFromInput(selection.start), timeFromInput(selection.end), dateFromInput(selection.end))
    selection.view.calendar.unselect()
  }
  const clickEvent = (click: EventClickArg): void => openEventReference(click.event.extendedProps as CalendarItemReference)
  const replaceOccurrence = async (record: CalendarEventRecord, occurrenceDate: string, event: CalendarEventRecord | null): Promise<boolean> => {
    const now = new Date().toISOString()
    const series = excludeCalendarOccurrence(record, occurrenceDate, now)
    const exception = event === null ? null : exceptionForOccurrence(event, record.id, occurrenceDate)
    return updateCalendarState(() => window.manor.calendar.replaceOccurrence({ series, occurrenceDate, exception }))
  }
  const persistMove = (change: EventDropArg | EventResizeDoneArg): void => {
    const reference = change.event.extendedProps as CalendarItemReference
    if (reference.kind !== 'event' || change.event.start === null) { change.revert(); return }
    const nextStart = change.event.start
    const sourceRecord = calendarState.events.find((event) => event.id === reference.sourceId)
    const oldStart = 'oldEvent' in change ? change.oldEvent.start : null
    if (sourceRecord === undefined || oldStart === null) { change.revert(); return }
    const record = sourceRecord.recurrenceParentId === null
      ? sourceRecord
      : calendarState.events.find((event) => event.id === sourceRecord.recurrenceParentId)
    if (record === undefined) { change.revert(); setError(`Recurring event ${sourceRecord.title} is missing its parent series`); return }
    if (record.recurrence !== null) {
      const occurrenceDate = sourceRecord.recurrenceParentId === null ? occurrenceDateFor(reference, record) : sourceRecord.recurrenceOriginalDate
      if (occurrenceDate === null) { change.revert(); return }
      const nextEnd = change.event.end
      change.revert()
      setPendingRecurringChange({ record, occurrenceDate, occurrenceEvent: sourceRecord.recurrenceParentId === null ? calendarEventForOccurrence(record, occurrenceDate) : sourceRecord, oldStart, nextStart, nextEnd, action: 'endDelta' in change ? 'resize' : 'move' })
      return
    }
    void updateCalendarState(() => window.manor.calendar.upsertEvent(shiftedCalendarGridEvent(record, oldStart, nextStart, change.event.end, primaryTimeZone, new Date().toISOString()))).then((saved) => { if (!saved) change.revert() })
  }
  const applyRecurringChange = (scope: EventEditScope): void => {
    const pending = pendingRecurringChange
    if (pending === null) return
    const operation = scope === 'series'
      ? updateCalendarState(() => window.manor.calendar.upsertEvent(shiftedCalendarGridEvent(pending.record, pending.oldStart, pending.nextStart, pending.nextEnd, primaryTimeZone, new Date().toISOString())))
      : (() => {
          const occurrence = pending.occurrenceEvent
          const shifted = shiftOccurrenceFromCalendarGrid(occurrence, pending.nextStart, pending.nextEnd, primaryTimeZone, new Date().toISOString())
          return replaceOccurrence(pending.record, pending.occurrenceDate, shifted)
        })()
    void operation.then((saved) => { if (saved) setPendingRecurringChange(null) })
  }
  const duplicateEvent = (event: CalendarEventRecord, scope: EventEditScope): void => {
    const now = new Date().toISOString()
    const recurrence = scope === 'occurrence' ? null : event.recurrence === null ? null : { ...event.recurrence, excludedDates: [] }
    const copy = parseCalendarEvent({ ...event, id: `calendar-event-${crypto.randomUUID()}`, title: `${event.title} copy`, recurrence, recurrenceParentId: null, recurrenceOriginalDate: null, createdAt: now, updatedAt: now })
    void updateCalendarState(() => window.manor.calendar.upsertEvent(copy)).then((saved) => { if (saved) setEventDialog({ event: copy, creating: false, confirmDelete: false, occurrenceDate: null, occurrenceEvent: null }) })
  }
  const contextItems: readonly QuickActionItem[] = contextMenu === null ? [] : [
    { id: 'open', label: 'Open details', icon: <CalendarPlus size={15} />, tone: 'default', onSelect: () => openEventReference(contextMenu.reference) },
    ...(contextMenu.reference.kind === 'event' ? [
      { id: 'duplicate', label: 'Duplicate', icon: <Copy size={15} />, tone: 'default' as const, onSelect: () => {
        const record = calendarState.events.find((event) => event.id === contextMenu.reference.sourceId)
        if (record !== undefined) {
          const occurrenceDate = occurrenceDateFor(contextMenu.reference, record)
          duplicateEvent(occurrenceDate === null ? record : calendarEventForOccurrence(record, occurrenceDate), occurrenceDate === null ? 'series' : 'occurrence')
        }
      } },
      { id: 'delete', label: 'Delete', icon: <Trash2 size={15} />, tone: 'danger' as const, onSelect: () => {
        const record = calendarState.events.find((event) => event.id === contextMenu.reference.sourceId)
        if (record !== undefined) {
          const parent = record.recurrenceParentId === null ? record : calendarState.events.find((event) => event.id === record.recurrenceParentId)
          if (parent !== undefined) {
            const occurrenceDate = record.recurrenceParentId === null ? occurrenceDateFor(contextMenu.reference, record) : record.recurrenceOriginalDate
            setEventDialog({ event: parent, creating: false, confirmDelete: true, occurrenceDate, occurrenceEvent: record.recurrenceParentId === null ? null : record })
          }
        }
      } }
    ] : [])
  ]

  return (
    <PageShell title="Calendar" fullBleed>
      <div className="cal-page">
        <CalendarSidebar anchor={anchor} calendars={calendarState.calendars} settings={calendarState.settings} overlays={overlays} upcoming={upcoming}
          onPickDay={(date) => { setAnchor(date); calendarRef.current?.getApi().gotoDate(date) }}
          onToggleCalendar={(calendar) => void updateCalendarState(() => window.manor.calendar.upsertCalendar({ ...calendar, visible: !calendar.visible, updatedAt: new Date().toISOString() }))}
          onEditCalendar={setCalendarDialog} onCreateCalendar={() => setCalendarDialog('new')}
          onToggleOverlay={(overlay) => setOverlays((current) => { const next = new Set(current); if (next.has(overlay)) next.delete(overlay); else next.add(overlay); return next })}
          onOpenSettings={() => setSettingsOpen(true)} onOpenUpcoming={openEventReference} />

        <section className="cal-main" aria-label="Calendar workspace">
          <header className="cal-toolbar">
            <div className="cal-toolbar-nav">
              <div className="cal-view-select">
                <Select
                  value={view}
                  options={VIEWS.map((option) => ({ value: option.id, label: option.label }))}
                  onChange={(nextView) => setView(nextView as CalendarWorkspaceView)}
                  placeholder="Week"
                  ariaLabel="Calendar view"
                />
              </div>
              <Button variant="ghost" onClick={goToToday}>Today</Button>
              <button type="button" className="cal-icon-btn" onClick={() => movePeriod(-1)} aria-label="Previous period"><ChevronLeft size={16} /></button>
              <button type="button" className="cal-icon-btn" onClick={() => movePeriod(1)} aria-label="Next period"><ChevronRight size={16} /></button>
            </div>
            <h1 className="cal-toolbar-title">{title}</h1>
            <label className="cal-search"><Search size={14} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search events" aria-label="Search calendar events" />{search === '' ? <kbd>/</kbd> : <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label>
            <span className="cal-toolbar-tools"><button type="button" className="cal-icon-btn" onClick={() => setHourHeight(Math.max(36, hourHeight - 8))} aria-label="Compress hours"><Minus size={15} /></button><button type="button" className="cal-icon-btn" onClick={() => setHourHeight(Math.min(84, hourHeight + 8))} aria-label="Expand hours"><Plus size={15} /></button><button type="button" className={`cal-icon-btn${allDayVisible ? ' is-active' : ''}`} onClick={() => setAllDayVisible(!allDayVisible)} aria-label={`${allDayVisible ? 'Hide' : 'Show'} all-day row`}><PanelTopClose size={15} /></button><button type="button" className="cal-icon-btn" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts"><HelpCircle size={15} /></button><button type="button" className="cal-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Calendar settings"><Settings2 size={15} /></button></span>
          </header>
          {error === null ? null : <div className="cal-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
          <CalendarGrid ref={calendarRef} view={view} events={inputs} settings={calendarState.settings} hourHeight={hourHeight} allDayVisible={allDayVisible}
            onSelect={selectRange} onEventClick={clickEvent}
            onEventContextMenu={(click, point) => setContextMenu({ point: { ...point, source: 'pointer' }, reference: click.event.extendedProps as CalendarItemReference })}
            onEventDrop={persistMove} onEventResize={persistMove}
            onDatesSet={(dates: DatesSetArg) => {
              const nextRange = { start: calendarGridDate(dates.start), end: calendarGridDate(dates.end) }
              setRange(nextRange)
              setAnchor((current) => current >= nextRange.start && current < nextRange.end ? current : calendarGridDate(dates.view.currentStart))
            }} />
        </section>

        <EventDialog open={eventDialog !== null} event={eventDialog?.event ?? null} calendars={calendarState.calendars} creating={eventDialog?.creating ?? false} confirmingDelete={eventDialog?.confirmDelete ?? false} occurrenceDate={eventDialog?.occurrenceDate ?? null} occurrenceEvent={eventDialog?.occurrenceEvent ?? null} timeFormat={calendarState.settings.timeFormat} notePages={notesState.pages} onClose={() => setEventDialog(null)}
          onSave={(event, scope) => {
            const operation = scope === 'occurrence' && eventDialog?.occurrenceDate !== null && eventDialog?.occurrenceDate !== undefined
              ? replaceOccurrence(eventDialog.event, eventDialog.occurrenceDate, event)
              : updateCalendarState(() => window.manor.calendar.upsertEvent(event))
            void operation.then((saved) => {
              if (!saved) return
              setEventDialog(null)
              setSelectedEventId(scope === 'occurrence' ? null : event.id)
              setSelectedOccurrenceDate(null)
            })
          }}
          onDuplicate={duplicateEvent}
          onDelete={(eventId, scope) => {
            const operation = scope === 'occurrence' && eventDialog?.occurrenceDate !== null && eventDialog?.occurrenceDate !== undefined
              ? replaceOccurrence(eventDialog.event, eventDialog.occurrenceDate, null)
              : updateCalendarState(() => window.manor.calendar.deleteEvent(eventId))
            void operation.then((saved) => { if (saved) { setEventDialog(null); setSelectedEventId(null); setSelectedOccurrenceDate(null) } })
          }} onOpenNote={(notePageId) => { setEventDialog(null); navigate(`/notes?note=${encodeURIComponent(notePageId)}`) }} />
        <LinkedCalendarDialog reference={linkedReference} tasks={homeState.tasks} blocks={homeState.scratchBlocks} roles={jobsState.roles} onClose={() => setLinkedReference(null)} onOpenModule={(module) => navigate(module === 'home' ? '/home' : '/jobs')} />
        <CalendarEditorDialog
          open={calendarDialog !== null}
          calendar={calendarDialog === 'new' ? null : calendarDialog}
          onClose={() => setCalendarDialog(null)}
          onSave={(name, color) => {
            const now = new Date().toISOString()
            const next: CalendarDefinition = calendarDialog === null || calendarDialog === 'new'
              ? { id: `calendar-${crypto.randomUUID()}`, name, color, visible: true, readOnly: false, source: 'local', createdAt: now, updatedAt: now }
              : { ...calendarDialog, name, color, updatedAt: now }
            void updateCalendarState(() => window.manor.calendar.upsertCalendar(next)).then((saved) => { if (saved) setCalendarDialog(null) })
          }}
          onDelete={calendarDialog === null || calendarDialog === 'new' || calendarDialog.readOnly ? null : () => void updateCalendarState(() => window.manor.calendar.deleteCalendar(calendarDialog.id)).then((saved) => { if (saved) setCalendarDialog(null) })}
        />
        <CalendarSettingsDialog open={settingsOpen} settings={calendarState.settings} onClose={() => setSettingsOpen(false)} onSave={(settings: CalendarSettings) => void updateCalendarState(() => window.manor.calendar.updateSettings(settings)).then((saved) => { if (saved) setSettingsOpen(false) })} />
        <CalendarShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <CalendarCommandMenu open={commandsOpen} commands={commands} onClose={() => setCommandsOpen(false)} />
        <RecurringChangeDialog open={pendingRecurringChange !== null} title={pendingRecurringChange?.record.title ?? 'Recurring event'} action={pendingRecurringChange?.action ?? 'move'} onClose={() => setPendingRecurringChange(null)} onApply={applyRecurringChange} />
        {contextMenu === null ? null : <QuickActionsMenu point={contextMenu.point} label="Calendar item actions" items={contextItems} onClose={() => setContextMenu(null)} />}
      </div>
    </PageShell>
  )
}
