import { Coffee, Pause, Play, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import { POMODORO_LABEL_LIMIT, formatClock, plannedSeconds } from '../../../shared/pomodoro'
import type { PomodoroClock, PomodoroKind, PomodoroSession, PomodoroSettings } from '../../../shared/pomodoro'
import { Button } from '../../components/ui'
import { cyclePosition, kindLabel, kindTone } from './pomodoroModel'

const RING_SIZE = 256
const RING_STROKE = 8
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

export interface TimerStageProps {
  active: PomodoroSession | null
  clock: PomodoroClock | null
  /** The session whose time just ran out and has not been acknowledged. */
  ended: PomodoroSession | null
  next: PomodoroKind
  settings: PomodoroSettings
  completedToday: number
  busy: boolean
  onStart: (kind: PomodoroKind, label: string | null) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onRelabel: (label: string | null) => void
  onDismissEnded: () => void
}

/** The ring, the clock, and the controls. One session at a time, and the finished ring holds until the next step is chosen. */
export function TimerStage({ active, clock, ended, next, settings, completedToday, busy, onStart, onPause, onResume, onStop, onRelabel, onDismissEnded }: TimerStageProps): ReactNode {
  const [draftLabel, setDraftLabel] = useState('')
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [bloom, setBloom] = useState<string | null>(null)
  const labelInput = useRef<HTMLInputElement | null>(null)

  const shown = active ?? ended
  const kind: PomodoroKind = shown?.kind ?? next
  const tone = kindTone(kind)
  const progress = active !== null && clock !== null ? clock.progress : ended !== null ? 1 : 0
  const seconds = active !== null && clock !== null ? clock.remainingSeconds : ended !== null ? ended.plannedSeconds : plannedSeconds(next, settings)
  const phase: 'idle' | 'running' | 'paused' | 'ended' = active !== null ? (active.status === 'paused' ? 'paused' : 'running') : ended !== null ? 'ended' : 'idle'

  // The bloom plays once per finished session, on the render where it appears.
  useEffect(() => {
    if (ended !== null) setBloom(ended.id)
  }, [ended])

  useEffect(() => {
    if (editingLabel !== null) labelInput.current?.select()
  }, [editingLabel])

  const startFocus = (): void => {
    onDismissEnded()
    onStart('focus', draftLabel.trim() === '' ? null : draftLabel.trim())
    setDraftLabel('')
  }
  const startNext = (): void => {
    onDismissEnded()
    onStart(next, null)
  }
  const commitLabel = (): void => {
    if (editingLabel === null) return
    const trimmed = editingLabel.trim()
    if ((trimmed === '' ? null : trimmed) !== (active?.label ?? null)) onRelabel(trimmed === '' ? null : trimmed)
    setEditingLabel(null)
  }
  const onLabelKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') { event.preventDefault(); commitLabel() }
    if (event.key === 'Escape') { event.preventDefault(); setEditingLabel(null) }
  }

  const statusLine = phase === 'ended'
    ? (kind === 'focus' ? 'Focus complete' : 'Break over')
    : phase === 'paused' ? `${kindLabel(kind)} paused` : kindLabel(kind)
  const position = cyclePosition(completedToday, settings.longBreakEvery)

  return (
    <section className={`pomo-stage is-${tone} is-${phase}`} aria-label="Timer">
      <div className="pomo-ring-wrap">
        {bloom !== null && phase === 'ended' ? <span key={bloom} className="pomo-bloom" aria-hidden="true" /> : null}
        <svg className="pomo-ring" viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} width={RING_SIZE} height={RING_SIZE} aria-hidden="true">
          <circle className="pomo-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} />
          <circle
            className="pomo-ring-arc"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap={progress >= 1 ? 'butt' : 'round'}
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
        <div className="pomo-ring-face">
          <span className="pomo-ring-kind">{statusLine}</span>
          <span className="pomo-ring-time tnum" role="timer" aria-live={phase === 'ended' ? 'polite' : 'off'} aria-label={`${formatClock(seconds)} ${phase === 'ended' ? 'done' : 'remaining'}`}>
            {formatClock(seconds)}
          </span>
          {kind === 'focus' && phase !== 'ended' ? (
            <span className="pomo-ring-cycle" aria-label={`${completedToday} focus sessions completed today`}>
              {Array.from({ length: settings.longBreakEvery }, (_, index) => (
                <span key={index} className={`pomo-cycle-dot${index < position ? ' is-done' : ''}`} aria-hidden="true" />
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="pomo-label-row">
        {phase === 'idle' ? (
          <input
            className="pomo-label-input"
            value={draftLabel}
            maxLength={POMODORO_LABEL_LIMIT}
            placeholder="What are you focusing on?"
            aria-label="Session label"
            onChange={(event) => setDraftLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !busy) startFocus() }}
          />
        ) : active !== null && active.kind === 'focus' ? (
          editingLabel !== null ? (
            <input
              ref={labelInput}
              className="pomo-label-input"
              value={editingLabel}
              maxLength={POMODORO_LABEL_LIMIT}
              placeholder="What are you focusing on?"
              aria-label="Session label"
              onChange={(event) => setEditingLabel(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={onLabelKey}
            />
          ) : (
            <button type="button" className={`pomo-label-text${active.label === null ? ' is-empty' : ''}`} onClick={() => setEditingLabel(active.label ?? '')} title="Edit label">
              {active.label ?? 'Add a label'}
            </button>
          )
        ) : (
          <span className={`pomo-label-text is-static${shown?.label == null ? ' is-empty' : ''}`}>{shown?.label ?? (phase === 'ended' ? (kind === 'focus' ? 'Nice work.' : 'Ready when you are.') : 'Step away for a moment.')}</span>
        )}
      </div>

      <div className="pomo-controls">
        {phase === 'idle' ? (
          <>
            <Button variant="primary" icon={<Play size={16} />} onClick={startFocus} disabled={busy} testId="pomodoro-start">Start focus</Button>
            <Button variant="ghost" icon={<Coffee size={16} />} onClick={() => onStart('short_break', null)} disabled={busy}>Take a break</Button>
          </>
        ) : null}
        {phase === 'running' ? (
          <>
            <Button variant="primary" icon={<Pause size={16} />} onClick={onPause} disabled={busy} testId="pomodoro-pause">Pause</Button>
            <Button variant="ghost" icon={<Square size={14} />} onClick={onStop} disabled={busy} testId="pomodoro-stop">{kind === 'focus' ? 'Stop' : 'Skip break'}</Button>
          </>
        ) : null}
        {phase === 'paused' ? (
          <>
            <Button variant="primary" icon={<Play size={16} />} onClick={onResume} disabled={busy} testId="pomodoro-resume">Resume</Button>
            <Button variant="ghost" icon={<Square size={14} />} onClick={onStop} disabled={busy}>{kind === 'focus' ? 'Stop' : 'Skip break'}</Button>
          </>
        ) : null}
        {phase === 'ended' ? (
          <>
            <Button variant="primary" icon={next === 'focus' ? <Play size={16} /> : <Coffee size={16} />} onClick={startNext} disabled={busy} testId="pomodoro-next">
              {next === 'focus' ? 'Start focus' : `Start ${kindLabel(next).toLowerCase()}`}
            </Button>
            <Button variant="ghost" onClick={onDismissEnded} disabled={busy}>{next === 'focus' ? 'Not yet' : 'Skip break'}</Button>
          </>
        ) : null}
      </div>
    </section>
  )
}
