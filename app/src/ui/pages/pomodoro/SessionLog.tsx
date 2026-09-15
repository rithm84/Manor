import { Pencil, Timer, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import { POMODORO_LABEL_LIMIT, formatMinutes, shiftDate } from '../../../shared/pomodoro'
import type { PomodoroSession } from '../../../shared/pomodoro'
import { Button, EmptyState } from '../../components/ui'
import { dayHeading, startTimeLabel } from './pomodoroModel'
import type { SessionDay } from './pomodoroModel'

const INITIAL_DAYS = 7

export interface SessionLogProps {
  days: readonly SessionDay[]
  today: string
  timezone: string
  busy: boolean
  onRelabel: (id: string, label: string | null) => void
  onRemove: (id: string) => void
}

function SessionRow({ session, timezone, busy, onRelabel, onRemove }: { session: PomodoroSession; timezone: string; busy: boolean; onRelabel: (label: string | null) => void; onRemove: () => void }): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useEffect(() => { if (draft !== null) input.current?.select() }, [draft])

  const commit = (): void => {
    if (draft === null) return
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : trimmed
    if (next !== session.label) onRelabel(next)
    setDraft(null)
  }
  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); commit() }
    if (event.key === 'Escape') { event.preventDefault(); setDraft(null) }
  }
  const focused = session.focusedSeconds ?? 0
  const completed = session.status === 'completed'
  const description = `${startTimeLabel(session, timezone)}, ${session.label ?? 'focus session'}, ${completed ? `${formatMinutes(focused)} completed` : `stopped after ${formatMinutes(focused)} of ${formatMinutes(session.plannedSeconds)}`}`

  return (
    <li className={`pomo-row${completed ? ' is-completed' : ' is-abandoned'}`} aria-label={description} data-testid={`pomodoro-row-${session.id}`}>
      <span className="pomo-row-time tnum">{startTimeLabel(session, timezone)}</span>
      <span className="pomo-row-mark" aria-hidden="true" />
      {draft !== null ? (
        <input
          ref={input}
          className="pomo-row-input"
          value={draft}
          maxLength={POMODORO_LABEL_LIMIT}
          placeholder="Session label"
          aria-label="Session label"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
      ) : (
        <span className={`pomo-row-label${session.label === null ? ' is-empty' : ''}`}>{session.label ?? 'Focus session'}</span>
      )}
      <span className="pomo-row-duration tnum">
        {completed ? formatMinutes(focused) : <>{formatMinutes(focused)}<span className="pomo-row-of"> of {formatMinutes(session.plannedSeconds)}</span></>}
      </span>
      <span className="pomo-row-actions">
        <button type="button" className="pomo-iconbutton" aria-label="Edit label" disabled={busy} onClick={() => setDraft(session.label ?? '')}><Pencil size={14} /></button>
        <button type="button" className="pomo-iconbutton is-danger" aria-label="Delete session" disabled={busy} onClick={onRemove}><Trash2 size={14} /></button>
      </span>
    </li>
  )
}

export function SessionLog({ days, today, timezone, busy, onRelabel, onRemove }: SessionLogProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const yesterday = shiftDate(today, -1)
  const shown = expanded ? days : days.slice(0, INITIAL_DAYS)
  const hidden = days.length - shown.length

  return (
    <section className="pomo-log" aria-labelledby="pomo-log-title">
      <div className="pomo-sectionhead">
        <div>
          <h3 id="pomo-log-title">Sessions</h3>
          <p>Every focus session this month, newest first.</p>
        </div>
      </div>
      {days.length === 0 ? (
        <EmptyState icon={<Timer size={20} />} title="No focus sessions yet" message="Start the timer and finished sessions will collect here." />
      ) : (
        <>
          {shown.map((day) => (
            <div key={day.date} className="pomo-day">
              <h4 className="pomo-day-heading">
                <span>{dayHeading(day.date, today, yesterday)}</span>
                <span className="tnum">{day.sessions.filter((session) => session.status === 'completed').length} completed</span>
              </h4>
              <ul className="pomo-rows">
                {day.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} timezone={timezone} busy={busy} onRelabel={(label) => onRelabel(session.id, label)} onRemove={() => onRemove(session.id)} />
                ))}
              </ul>
            </div>
          ))}
          {hidden > 0 ? (
            <div className="pomo-log-more">
              <Button variant="subtle" onClick={() => setExpanded(true)}>Show {hidden} more {hidden === 1 ? 'day' : 'days'}</Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
