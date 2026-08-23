import { CalendarDays, Clock, MoveRight, SquareCheckBig, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, DetailDialog, Input } from '../../components/ui'
import { calendars, jobRoles, tasks } from '../../data/mock'
import type { CalendarEvent } from '../../data/mock'
import type { JobRole } from '../../../../shared/jobs'
import { formatTime, panelDateLabel } from './calendarModel'

export type CalendarSelection = { kind: 'event'; id: string } | { kind: 'oa'; id: string }

export interface EventDetailDialogProps {
  selection: CalendarSelection | null
  events: readonly CalendarEvent[]
  onClose: () => void
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
}

/** Centered calendar object details. The last selection remains during dismissal. */
export function EventDetailDialog({
  selection,
  events,
  onClose,
  onRename,
  onRemove
}: EventDetailDialogProps): ReactNode {
  const [displaySelection, setDisplaySelection] = useState<CalendarSelection | null>(selection)
  const currentEvent =
    selection?.kind === 'event'
      ? events.find((event) => event.id === selection.id)
      : undefined
  const [displayEvent, setDisplayEvent] = useState<CalendarEvent | undefined>(currentEvent)

  useEffect(() => {
    if (selection !== null) setDisplaySelection(selection)
  }, [selection])

  useEffect(() => {
    if (currentEvent !== undefined) setDisplayEvent(currentEvent)
  }, [currentEvent])

  const activeSelection = selection ?? displaySelection
  if (activeSelection === null) return null

  const selectedEvent =
    activeSelection.kind === 'event'
      ? events.find((event) => event.id === activeSelection.id) ??
        (displayEvent?.id === activeSelection.id ? displayEvent : undefined)
      : undefined
  const selectedDeadline =
    activeSelection.kind === 'oa'
      ? jobRoles.find((candidate) => candidate.id === activeSelection.id)
      : undefined
  const ariaLabel =
    selectedEvent !== undefined
      ? `Event details for ${selectedEvent.title}`
      : selectedDeadline !== undefined
        ? `Deadline details for ${selectedDeadline.company}`
        : 'Calendar details'

  return (
    <DetailDialog
      open={selection !== null}
      onClose={onClose}
      title={activeSelection.kind === 'oa' ? 'Deadline' : 'Event'}
      width={440}
      ariaLabel={ariaLabel}
    >
      {activeSelection.kind === 'event' ? (
        <EventDetails
          event={selectedEvent}
          onRename={onRename}
          onRemove={onRemove}
        />
      ) : (
        <DeadlineDetails entry={selectedDeadline} />
      )}
    </DetailDialog>
  )
}

function EventDetails({
  event,
  onRename,
  onRemove
}: {
  event: CalendarEvent | undefined
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
}): ReactNode {
  if (event === undefined) {
    return null
  }
  const calendar = calendars.find((source) => source.id === event.calendarId)
  const linkedTask = event.taskId !== null ? tasks.find((task) => task.id === event.taskId) : undefined

  return (
    <div className="cal-detail-body">
      {event.scratch ? (
        <Input
          value={event.title}
          onChange={(title) => onRename(event.id, title)}
          placeholder="Name this block"
          ariaLabel="Block title"
        />
      ) : (
        <h2 className="cal-detail-title">{event.title}</h2>
      )}

      <div className="cal-detail-rows">
        <div className="cal-detail-row">
          <Clock size={14} />
          <span className="tnum">{formatTime(event.start)}</span>
          <MoveRight size={12} className="cal-detail-arrow" />
          <span className="tnum">{formatTime(event.end)}</span>
        </div>
        <div className="cal-detail-row">
          <CalendarDays size={14} />
          <span>{panelDateLabel(event.date)}</span>
        </div>
        {calendar !== undefined ? (
          <div className="cal-detail-row">
            <span
              className={`cal-detail-swatch${calendar.scratch ? ' is-dashed' : ''}`}
              style={{ ['--swatch' as string]: calendar.color }}
              aria-hidden="true"
            />
            <span>{calendar.name}</span>
          </div>
        ) : null}
        {linkedTask !== undefined ? (
          <Link to="/home" className="cal-detail-task">
            <SquareCheckBig size={14} />
            <span>{linkedTask.title}</span>
          </Link>
        ) : null}
      </div>

      {event.note !== null ? <p className="cal-detail-note">{event.note}</p> : null}

      <div className="cal-detail-actions">
        <Button
          variant="ghost"
          icon={<Trash2 size={14} />}
          onClick={() => onRemove(event.id)}
        >
          {event.scratch ? 'Clear block' : 'Remove'}
        </Button>
      </div>
    </div>
  )
}

function DeadlineDetails({ entry }: { entry: JobRole | undefined }): ReactNode {
  if (entry === undefined) {
    return null
  }
  return (
    <div className="cal-detail-body">
      <h2 className="cal-detail-title">{entry.company} OA</h2>
      <div className="cal-detail-rows">
        <div className="cal-detail-row">
          <span className="cal-detail-role">{entry.role}</span>
        </div>
        <div className="cal-detail-row">
          <Clock size={14} />
          <span>{entry.oaDueDate === null ? 'No due date' : `Due ${panelDateLabel(entry.oaDueDate)}`}</span>
        </div>
      </div>
      <div className="cal-detail-actions">
        <Link to="/jobs" className="cal-detail-jobs-link">
          Open in Jobs
        </Link>
      </div>
    </div>
  )
}
