import { CalendarDays, Clock, MoveRight, SquareCheckBig, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Button, Input } from '../../components/ui'
import { calendars, pipeline, tasks } from '../../data/mock'
import type { CalendarEvent } from '../../data/mock'
import { formatTime, panelDateLabel } from './calendarModel'

export type CalendarSelection = { kind: 'event'; id: string } | { kind: 'oa'; id: string }

export interface EventPanelProps {
  selection: CalendarSelection
  events: readonly CalendarEvent[]
  onClose: () => void
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
}

/** The right details panel (Cron anatomy). Content follows the selection. */
export function EventPanel({
  selection,
  events,
  onClose,
  onRename,
  onRemove
}: EventPanelProps): ReactNode {
  return (
    <aside className="cal-panel" aria-label="Details">
      <div className="cal-panel-head">
        <span className="cal-panel-kicker">{selection.kind === 'oa' ? 'Deadline' : 'Event'}</span>
        <button type="button" className="cal-panel-close" onClick={onClose} aria-label="Close details">
          <X size={15} />
        </button>
      </div>
      {selection.kind === 'event' ? (
        <EventDetails
          event={events.find((event) => event.id === selection.id)}
          onRename={onRename}
          onRemove={onRemove}
        />
      ) : (
        <DeadlineDetails id={selection.id} />
      )}
    </aside>
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
    <div className="cal-panel-body">
      {event.scratch ? (
        <Input
          value={event.title}
          onChange={(title) => onRename(event.id, title)}
          placeholder="Name this block"
          ariaLabel="Block title"
        />
      ) : (
        <h2 className="cal-panel-title">{event.title}</h2>
      )}

      <div className="cal-panel-rows">
        <div className="cal-panel-row">
          <Clock size={14} />
          <span className="tnum">{formatTime(event.start)}</span>
          <MoveRight size={12} className="cal-panel-arrow" />
          <span className="tnum">{formatTime(event.end)}</span>
        </div>
        <div className="cal-panel-row">
          <CalendarDays size={14} />
          <span>{panelDateLabel(event.date)}</span>
        </div>
        {calendar !== undefined ? (
          <div className="cal-panel-row">
            <span
              className={`cal-panel-swatch${calendar.scratch ? ' is-dashed' : ''}`}
              style={{ ['--swatch' as string]: calendar.color }}
              aria-hidden="true"
            />
            <span>{calendar.name}</span>
          </div>
        ) : null}
        {linkedTask !== undefined ? (
          <Link to="/home" className="cal-panel-task">
            <SquareCheckBig size={14} />
            <span>{linkedTask.title}</span>
          </Link>
        ) : null}
      </div>

      {event.note !== null ? <p className="cal-panel-note">{event.note}</p> : null}

      <div className="cal-panel-actions">
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

function DeadlineDetails({ id }: { id: string }): ReactNode {
  const entry = pipeline.find((candidate) => candidate.id === id)
  if (entry === undefined) {
    return null
  }
  return (
    <div className="cal-panel-body">
      <h2 className="cal-panel-title">{entry.company} OA</h2>
      <div className="cal-panel-rows">
        <div className="cal-panel-row">
          <span className="cal-panel-role">{entry.role}</span>
        </div>
        <div className="cal-panel-row">
          <Clock size={14} />
          <span>{entry.detail}</span>
        </div>
      </div>
      <div className="cal-panel-actions">
        <Link to="/jobs" className="cal-panel-jobs-link">
          Open in Jobs
        </Link>
      </div>
    </div>
  )
}
