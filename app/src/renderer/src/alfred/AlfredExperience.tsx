import {
  ArrowUpRight,
  CheckCircle2,
  Code2,
  ListChecks,
  Mic,
  MicOff,
  Smile,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { AlfredRoute } from '../../../shared/alfred'
import { ThinkingOrb } from '../components/orb/ThinkingOrb'
import type { OrbState } from '../components/orb/ThinkingOrb'
import { Kbd } from '../components/ui'
import { useCompletionGlance } from './useCompletionGlance'
import { useMicrophoneCapture } from './useMicrophoneCapture'
import './alfred.css'

export interface AlfredExperienceProps {
  active: boolean
  variant: 'modal' | 'panel'
  onEnd: () => void
  onNavigate: (route: AlfredRoute) => void
}

const STATUS_LABEL = {
  idle: 'Session closed',
  requesting: 'Requesting microphone',
  listening: 'Listening',
  muted: 'Microphone muted',
  denied: 'Microphone access denied',
  error: 'Microphone unavailable'
} as const

const COMPLETION_ICONS: Readonly<Record<string, ReactNode>> = {
  tasks: <ListChecks size={15} />,
  habits: <CheckCircle2 size={15} />,
  'mood-focus': <Smile size={15} />,
  leetcode: <Code2 size={15} />
}

export function AlfredExperience({
  active,
  variant,
  onEnd,
  onNavigate
}: AlfredExperienceProps): ReactNode {
  const microphone = useMicrophoneCapture(active)
  const completion = useCompletionGlance(active)
  const orbState: OrbState = microphone.state === 'listening'
    ? 'listening'
    : microphone.state === 'requesting'
      ? 'thinking'
      : 'idle'

  return (
    <section
      className={`alfred-surface alfred-surface--${variant}`}
      aria-label="Alfred voice session"
      data-testid={`alfred-${variant}`}
    >
      <header className="alfred-header">
        <div>
          <h1>Alfred</h1>
          <span className="alfred-shortcut"><Kbd keys={['⌥', 'Space']} /></span>
        </div>
        <button type="button" className="alfred-icon-button" onClick={onEnd} aria-label="End Alfred session">
          <X size={17} />
        </button>
      </header>

      <div className="alfred-presence">
        <ThinkingOrb
          size={variant === 'panel' ? 132 : 116}
          state={orbState}
          audioLevelRef={microphone.audioLevelRef}
        />
        <p className={`alfred-session-state is-${microphone.state}`} aria-live="polite">
          <span className="alfred-state-dot" aria-hidden="true" />
          {STATUS_LABEL[microphone.state]}
        </p>
        {microphone.state === 'denied' ? (
          <p className="alfred-permission-note">Allow microphone access in System Settings, then summon Alfred again.</p>
        ) : null}
        {microphone.state === 'error' && microphone.error !== null ? (
          <p className="alfred-permission-note" role="alert">{microphone.error}</p>
        ) : null}
      </div>

      <div className="alfred-controls" aria-label="Voice controls">
        <button
          type="button"
          className={`alfred-mic-button${microphone.muted ? ' is-muted' : ''}`}
          onClick={() => microphone.setMuted(!microphone.muted)}
          disabled={microphone.state !== 'listening' && microphone.state !== 'muted'}
          aria-pressed={microphone.muted}
        >
          {microphone.muted ? <MicOff size={17} /> : <Mic size={17} />}
          {microphone.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className="alfred-end-button" onClick={onEnd}>
          End session
        </button>
      </div>

      <section className="alfred-today" aria-labelledby={`alfred-today-${variant}`}>
        <div className="alfred-today-heading">
          <h2 id={`alfred-today-${variant}`}>Today</h2>
          {completion.glance !== null ? (
            <span className="tnum">{completion.glance.done}/{completion.glance.total}</span>
          ) : null}
        </div>
        {completion.loading ? <p className="alfred-glance-message">Loading today</p> : null}
        {completion.error !== null ? <p className="alfred-glance-message" role="alert">Today could not be loaded.</p> : null}
        {completion.glance?.items.map((item) => {
          const percent = item.total === 0 ? 0 : Math.round((item.done / item.total) * 100)
          return (
            <button
              key={item.key}
              type="button"
              className="alfred-completion-row"
              onClick={() => onNavigate(item.route)}
              aria-label={`${item.label}, ${item.done} of ${item.total}. Open ${item.label}.`}
            >
              <span className="alfred-completion-icon" aria-hidden="true">{COMPLETION_ICONS[item.key]}</span>
              <span className="alfred-completion-label">{item.label}</span>
              <span className="alfred-completion-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </span>
              <span className="alfred-completion-value tnum">{item.done}/{item.total}</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          )
        })}
      </section>
    </section>
  )
}
