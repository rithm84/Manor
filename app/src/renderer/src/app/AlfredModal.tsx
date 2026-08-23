import { Flame, Snowflake } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { ThinkingOrb } from '../components/orb/ThinkingOrb'
import type { OrbState } from '../components/orb/ThinkingOrb'
import { Kbd, Modal } from '../components/ui'
import { alfredAudit, alfredSampleExchange, habitsSummary, leetcodeStats } from '../data/mock'

const STATE_LINE: Record<OrbState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  thinking: 'Thinking'
}

const NEXT_STATE: Record<OrbState, OrbState> = {
  idle: 'listening',
  listening: 'thinking',
  thinking: 'idle'
}

export interface AlfredModalProps {
  open: boolean
  onClose: () => void
}

/**
 * The Alfred summon modal (global hotkey: Option+Space). Voice-only: the
 * thinking orb, the state line, the latest exchange, and the locked
 * completion glance. Clicking the orb cycles its state (mock).
 */
export function AlfredModal({ open, onClose }: AlfredModalProps): ReactNode {
  const [orbState, setOrbState] = useState<OrbState>('listening')

  useEffect(() => {
    if (open) {
      setOrbState('listening')
    }
  }, [open])

  const lastAction = alfredAudit[0]

  return (
    <Modal open={open} onClose={onClose} width={440} ariaLabel="Alfred">
      <div className="alfred">
        <button
          type="button"
          className="alfred-orb"
          onClick={() => setOrbState(NEXT_STATE[orbState])}
          aria-label={`Change Alfred state. Current: ${STATE_LINE[orbState]}.`}
        >
          <ThinkingOrb size={96} state={orbState} />
        </button>
        <span className="alfred-state" aria-live="polite">
          {STATE_LINE[orbState]}
        </span>

        <div className="alfred-exchange" data-slot="alfred-voice">
          <p className="alfred-line alfred-line--user">{alfredSampleExchange.userSaid}</p>
          <p className="alfred-line alfred-line--alfred">{alfredSampleExchange.alfredSaid}</p>
        </div>

        {/* Today's completion at a glance: this spot is locked. */}
        <div className="alfred-glance" data-slot="alfred-glance">
          <span className="alfred-glance-dots" aria-label="Habits done today">
            {Array.from({ length: alfredSampleExchange.glanceTotal }, (_, index) => (
              <span
                key={index}
                className={`alfred-glance-dot${index < alfredSampleExchange.glanceDone ? ' is-done' : ''}`}
              />
            ))}
          </span>
          <span className="alfred-glance-stat tnum">
            {alfredSampleExchange.glanceDone}/{alfredSampleExchange.glanceTotal}
          </span>
          <span className="alfred-glance-stat tnum" title={`Freezes left in ${habitsSummary.freezeMonthLabel}`}>
            <Snowflake size={13} />
            {habitsSummary.freezesLeft}
          </span>
          <span className="alfred-glance-stat tnum" title="LeetCode streak">
            <Flame size={13} />
            {leetcodeStats.streak}
          </span>
        </div>

        <div className="alfred-last">
          <span>
            {lastAction.action}, {lastAction.whenLabel}
          </span>
          <Link to="/alfred-activity" className="alfred-last-link" onClick={onClose}>
            All activity
          </Link>
        </div>

        <div className="alfred-hints">
          <span className="alfred-hint">
            <Kbd keys={['⌥', 'Space']} /> summon
          </span>
          <span className="alfred-hint">
            <Kbd keys={['Esc']} /> dismiss
          </span>
        </div>
      </div>
    </Modal>
  )
}
