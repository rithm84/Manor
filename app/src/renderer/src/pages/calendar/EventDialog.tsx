import { ArrowRight, Bell, CalendarDays, Clock3, Copy, Ellipsis, ExternalLink, FileText, Globe2, MapPin, Repeat2, Trash2, Video, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { addCalendarDays, calendarEventForOccurrence, parseCalendarEvent } from '../../../../shared/calendar'
import type { CalendarDefinition, CalendarEventRecord, CalendarFrequency } from '../../../../shared/calendar'
import type { NotePage } from '../../../../shared/notes'
import { DatePicker, Select, TimePicker } from '../../components/ui'

export type EventEditScope = 'occurrence' | 'series'

const TIME_ZONES = [
  'America/Los_Angeles', 'America/New_York', 'UTC', 'Europe/London',
  'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'
] as const
const WEEKDAYS = [
  { value: 0, label: 'S' }, { value: 1, label: 'M' }, { value: 2, label: 'T' },
  { value: 3, label: 'W' }, { value: 4, label: 'T' }, { value: 5, label: 'F' },
  { value: 6, label: 'S' }
] as const
const REMINDERS = [
  { value: 0, label: 'At start' }, { value: 5, label: '5 min' }, { value: 10, label: '10 min' },
  { value: 30, label: '30 min' }, { value: 60, label: '1 hour' }, { value: 1440, label: '1 day' }
] as const

export interface EventDialogProps {
  open: boolean
  event: CalendarEventRecord | null
  calendars: readonly CalendarDefinition[]
  creating: boolean
  confirmingDelete: boolean
  occurrenceDate: string | null
  occurrenceEvent: CalendarEventRecord | null
  timeFormat: '12h' | '24h'
  notePages: readonly NotePage[]
  onClose: () => void
  onSave: (event: CalendarEventRecord, scope: EventEditScope) => void
  onDuplicate: (event: CalendarEventRecord, scope: EventEditScope) => void
  onDelete: (eventId: string, scope: EventEditScope) => void
  onOpenNote: (notePageId: string) => void
}

function editEndDate(event: CalendarEventRecord): string {
  return event.allDay ? addCalendarDays(event.endDate, -1) : event.endDate
}

function calendarDayDifference(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`)
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

function scopedDraft(event: CalendarEventRecord | null, occurrenceDate: string | null, occurrenceEvent: CalendarEventRecord | null, scope: EventEditScope): CalendarEventRecord | null {
  if (event === null || occurrenceDate === null || scope === 'series') return event
  return occurrenceEvent ?? calendarEventForOccurrence(event, occurrenceDate)
}

function eventTypeLabel(eventType: CalendarEventRecord['eventType']): string {
  if (eventType === 'focus') return 'Focus time'
  if (eventType === 'out_of_office') return 'Out of office'
  if (eventType === 'birthday') return 'Birthday'
  return 'Event'
}

function durationLabel(startTime: string | null, endTime: string | null): string | null {
  if (startTime === null || endTime === null) return null
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const duration = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute) + 1_440) % 1_440
  if (duration === 0) return '24h'
  const hours = Math.floor(duration / 60)
  const minutes = duration % 60
  return hours === 0 ? `${minutes}m` : minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function openableHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export function EventDialog({
  open,
  event,
  calendars,
  creating,
  confirmingDelete,
  occurrenceDate,
  occurrenceEvent,
  timeFormat,
  notePages,
  onClose,
  onSave,
  onDuplicate,
  onDelete,
  onOpenNote
}: EventDialogProps): ReactNode {
  const initialScope: EventEditScope = occurrenceDate === null ? 'series' : 'occurrence'
  const initialDraft = scopedDraft(event, occurrenceDate, occurrenceEvent, initialScope)
  const [scope, setScope] = useState<EventEditScope>(initialScope)
  const [draft, setDraft] = useState<CalendarEventRecord | null>(initialDraft)
  const [endDate, setEndDate] = useState(initialDraft === null ? '' : editEndDate(initialDraft))
  const [deleteConfirm, setDeleteConfirm] = useState(confirmingDelete)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteToAttach, setNoteToAttach] = useState<string | null>(null)
  const popoverRef = useRef<HTMLFormElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const nextScope = occurrenceDate === null ? 'series' : 'occurrence'
    const nextDraft = scopedDraft(event, occurrenceDate, occurrenceEvent, nextScope)
    setScope(nextScope)
    setDraft(nextDraft)
    setEndDate(nextDraft === null ? '' : editEndDate(nextDraft))
    setDeleteConfirm(confirmingDelete)
    setActionsOpen(false)
    setError(null)
    setNoteToAttach(null)
  }, [confirmingDelete, event, occurrenceDate, occurrenceEvent, open])

  const update = useCallback((fields: Partial<CalendarEventRecord>): void => {
    setDraft((current) => current === null ? null : { ...current, ...fields })
  }, [])

  const save = useCallback((): boolean => {
    if (draft === null) return false
    try {
      const normalized = parseCalendarEvent({
        ...draft,
        endDate: draft.allDay ? addCalendarDays(endDate, 1) : endDate,
        startTime: draft.allDay ? null : draft.startTime,
        endTime: draft.allDay ? null : draft.endTime,
        updatedAt: new Date().toISOString()
      })
      onSave(normalized, scope)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The event could not be saved')
      return false
    }
  }, [draft, endDate, onSave, scope])

  const closeOrSave = useCallback((): void => {
    if (draft === null || draft.title.trim() === '') { onClose(); return }
    save()
  }, [draft, onClose, save])

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.requestAnimationFrame(() => {
      const title = popoverRef.current?.querySelector<HTMLInputElement>('.cal-popover-title')
      title?.focus()
    })
    const onKeyDown = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key === 'Escape') {
        const openPicker = popoverRef.current?.querySelector('.ui-select-menu, .ui-datepicker-menu, .ui-timepicker-menu')
        if (openPicker !== null && openPicker !== undefined) return
        keyboardEvent.preventDefault()
        closeOrSave()
        return
      }
      if (keyboardEvent.key !== 'Tab' || popoverRef.current === null) return
      const focusable = Array.from(popoverRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (keyboardEvent.shiftKey && document.activeElement === first) { keyboardEvent.preventDefault(); last.focus() }
      else if (!keyboardEvent.shiftKey && document.activeElement === last) { keyboardEvent.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [closeOrSave, open])

  if (!open || draft === null) return null

  const recurrence = draft.recurrence
  const scopedOccurrence = occurrenceDate !== null && event?.recurrence !== null
  const duration = durationLabel(draft.startTime, draft.endTime)
  const editableCalendars = calendars.filter((calendar) => !calendar.readOnly && (scope === 'series' || calendar.id === event?.calendarId))
  const changeStartDate = (date: string | null): void => {
    if (date === null) return
    const durationDays = calendarDayDifference(draft.startDate, endDate)
    update({ startDate: date })
    setEndDate(addCalendarDays(date, durationDays))
  }
  const changeScope = (nextScope: string): void => {
    const nextDraft = scopedDraft(event, occurrenceDate, occurrenceEvent, nextScope as EventEditScope)
    if (nextDraft === null) return
    setScope(nextScope as EventEditScope)
    setDraft(nextDraft)
    setEndDate(editEndDate(nextDraft))
    setDeleteConfirm(false)
  }
  const setFrequency = (frequency: string): void => {
    if (frequency === 'none') { update({ recurrence: null }); return }
    const nextFrequency = frequency as CalendarFrequency
    update({
      recurrence: {
        frequency: nextFrequency,
        interval: recurrence?.interval ?? 1,
        weekdays: nextFrequency === 'weekly' ? (recurrence?.weekdays.length ? recurrence.weekdays : [new Date(`${draft.startDate}T00:00:00.000Z`).getUTCDay()]) : [],
        excludedDates: recurrence?.excludedDates ?? [],
        end: recurrence?.end ?? { type: 'never' }
      }
    })
  }

  return (
    <div className="cal-event-popover-layer" onPointerDown={(pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) closeOrSave() }}>
      <form ref={popoverRef} className="cal-event-popover" role="dialog" aria-modal="true" aria-label={creating ? 'Create event' : 'Edit event'} onSubmit={(submitEvent) => { submitEvent.preventDefault(); save() }}>
        <header className="cal-event-popover-header">
          <Select value={draft.eventType} options={[{ value: 'event', label: 'Event' }, { value: 'focus', label: 'Focus time' }, { value: 'out_of_office', label: 'Out of office' }, { value: 'birthday', label: 'Birthday' }]} onChange={(eventType) => update({ eventType: eventType as CalendarEventRecord['eventType'] })} placeholder={eventTypeLabel(draft.eventType)} ariaLabel="Event type" />
          <span />
          {!creating ? <button type="button" className="cal-popover-icon-button" aria-label="Event actions" aria-expanded={actionsOpen} onClick={() => setActionsOpen((current) => !current)}><Ellipsis size={19} /></button> : null}
          <button type="button" className="cal-popover-icon-button" aria-label="Close event editor" onClick={closeOrSave}><X size={21} /></button>
          {actionsOpen ? <div className="cal-event-action-menu"><button type="button" onClick={() => { setActionsOpen(false); onDuplicate(draft, scope) }}><Copy size={15} />Duplicate</button><button type="button" className="is-danger" onClick={() => { setActionsOpen(false); setDeleteConfirm(true) }}><Trash2 size={15} />Delete</button></div> : null}
        </header>

        <input className="cal-popover-title" autoFocus value={draft.title} onChange={(changeEvent) => update({ title: changeEvent.target.value })} maxLength={300} placeholder="Event title" aria-label="Event title" />
        {scopedOccurrence ? <div className="cal-popover-scope"><Select value={scope} options={[{ value: 'occurrence', label: 'This event' }, { value: 'series', label: 'All events' }]} onChange={changeScope} placeholder="This event" ariaLabel="Recurring event scope" /></div> : null}

        <section className="cal-popover-schedule">
          {draft.allDay ? null : <div className="cal-popover-time-row"><Clock3 size={20} /><TimePicker value={draft.startTime ?? '09:00'} format={timeFormat} onChange={(startTime) => update({ startTime })} ariaLabel="Event start time" /><ArrowRight size={20} /><TimePicker value={draft.endTime ?? '10:00'} format={timeFormat} onChange={(endTime) => update({ endTime })} ariaLabel="Event end time" />{duration === null ? null : <span>{duration}</span>}</div>}
          <div className="cal-popover-date-row"><CalendarDays size={20} /><DatePicker value={draft.startDate} onChange={changeStartDate} ariaLabel="Event start date" min={null} max={null} />{endDate === draft.startDate ? null : <><ArrowRight size={18} /><DatePicker value={endDate} onChange={(date) => date !== null && setEndDate(date)} ariaLabel="Event end date" min={draft.startDate} max={null} /></>}</div>
          <div className="cal-popover-meta-row">
            <button type="button" className={`cal-popover-meta-toggle${draft.allDay ? ' is-active' : ''}`} role="switch" aria-checked={draft.allDay} onClick={() => update({ allDay: !draft.allDay, startTime: draft.allDay ? '09:00' : null, endTime: draft.allDay ? '10:00' : null })}>All-day</button>
            <span className="cal-popover-meta-select"><Globe2 size={17} /><Select value={draft.timeZone} options={TIME_ZONES.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))} onChange={(timeZone) => update({ timeZone })} placeholder="Time zone" ariaLabel="Event time zone" /></span>
            {scope === 'series' ? <span className="cal-popover-meta-select"><Repeat2 size={17} /><Select value={recurrence?.frequency ?? 'none'} options={[{ value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} onChange={setFrequency} placeholder="Does not repeat" ariaLabel="Event recurrence" /></span> : null}
          </div>
        </section>

        {recurrence !== null && scope === 'series' ? <section className="cal-popover-recurrence" aria-label={`${eventTypeLabel(draft.eventType)} recurrence`}><label>Every <input type="number" min={1} max={365} value={recurrence.interval} onChange={(changeEvent) => update({ recurrence: { ...recurrence, interval: Number(changeEvent.target.value) } })} /> {recurrence.frequency === 'daily' ? 'days' : recurrence.frequency === 'weekly' ? 'weeks' : recurrence.frequency === 'monthly' ? 'months' : 'years'}</label>{recurrence.frequency === 'weekly' ? <div className="cal-weekday-options">{WEEKDAYS.map((weekday) => <button key={weekday.value} type="button" className={recurrence.weekdays.includes(weekday.value) ? 'is-selected' : ''} aria-pressed={recurrence.weekdays.includes(weekday.value)} onClick={() => update({ recurrence: { ...recurrence, weekdays: recurrence.weekdays.includes(weekday.value) ? recurrence.weekdays.filter((day) => day !== weekday.value) : [...recurrence.weekdays, weekday.value].sort() } })}>{weekday.label}</button>)}</div> : null}</section> : null}

        <section className="cal-popover-details">
          <label className="cal-popover-detail-field"><Video size={21} /><input type="url" value={draft.conferenceUrl} onChange={(changeEvent) => update({ conferenceUrl: changeEvent.target.value })} placeholder="Conferencing" aria-label="Conferencing URL" />{openableHttpUrl(draft.conferenceUrl) === null ? null : <button type="button" aria-label="Open conferencing URL" onClick={() => window.open(openableHttpUrl(draft.conferenceUrl) as string, '_blank', 'noopener,noreferrer')}><ExternalLink size={16} /></button>}</label>
          <label className="cal-popover-detail-field"><MapPin size={21} /><input value={draft.location} onChange={(changeEvent) => update({ location: changeEvent.target.value })} placeholder="Location" aria-label="Location" /></label>
          <div className="cal-popover-note-field"><FileText size={21} /><div>{draft.notePageIds.length === 0 ? <span>Attach note</span> : draft.notePageIds.map((notePageId) => { const note = notePages.find((page) => page.id === notePageId); return note === undefined ? null : <button key={note.id} type="button" onClick={() => onOpenNote(note.id)}>{note.title}</button> })}</div><Select value={noteToAttach} options={notePages.filter((page) => page.status === 'active' && !draft.notePageIds.includes(page.id)).map((page) => ({ value: page.id, label: page.title }))} onChange={(notePageId) => { update({ notePageIds: [...draft.notePageIds, notePageId] }); setNoteToAttach(null) }} placeholder="Add" ariaLabel="Attach note" /></div>
          <label className="cal-popover-description"><span>Description</span><textarea value={draft.description} onChange={(changeEvent) => update({ description: changeEvent.target.value })} rows={draft.description === '' ? 1 : 4} aria-label="Description" /></label>
        </section>

        <section className="cal-popover-calendar-settings">
          <span className="cal-popover-meta-select"><span className="cal-select-swatch" style={{ background: calendars.find((calendar) => calendar.id === draft.calendarId)?.color ?? '#6a4e6c' }} /><Select value={draft.calendarId} options={editableCalendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))} onChange={(calendarId) => update({ calendarId })} placeholder="Calendar" ariaLabel="Event calendar" /></span>
          <span className="cal-popover-meta-select"><Select value={draft.busyStatus} options={[{ value: 'busy', label: 'Busy' }, { value: 'free', label: 'Free' }]} onChange={(busyStatus) => update({ busyStatus: busyStatus as CalendarEventRecord['busyStatus'] })} placeholder="Busy" ariaLabel="Event availability" /></span>
          <span className="cal-popover-meta-select"><Select value={draft.visibility} options={[{ value: 'default', label: 'Default visibility' }, { value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} onChange={(visibility) => update({ visibility: visibility as CalendarEventRecord['visibility'] })} placeholder="Default visibility" ariaLabel="Event visibility" /></span>
          <span className="cal-popover-meta-select"><Bell size={17} /><Select value={String(draft.reminders[0] ?? 10)} options={REMINDERS.map((reminder) => ({ value: String(reminder.value), label: reminder.label }))} onChange={(reminder) => update({ reminders: [Number(reminder)] })} placeholder="Reminders" ariaLabel="Event reminder" /></span>
        </section>

        {deleteConfirm ? <div className="cal-popover-delete-confirm"><span>{scope === 'occurrence' ? 'Delete this event?' : recurrence === null ? 'Delete this event?' : 'Delete all events?'}</span><button type="button" onClick={() => setDeleteConfirm(false)}>Cancel</button><button type="button" onClick={() => onDelete(draft.id, scope)}>Delete</button></div> : null}
        {error === null ? null : <p className="cal-form-error" role="alert">{error}</p>}
      </form>
    </div>
  )
}
