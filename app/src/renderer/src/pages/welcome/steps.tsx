import { CalendarDays, Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { ThinkingOrb } from '../../components/orb/ThinkingOrb'
import { Button, Input, Kbd } from '../../components/ui'
import { habits } from '../../data/mock'

const ZERO_AUDIO_LEVEL = { current: 0 }

export function WelcomeIntro({ onContinue }: { onContinue: () => void }): ReactNode {
  return (
    <div className="welcome-step">
      <h1 className="welcome-headline">Welcome to Manor</h1>
      <p className="welcome-sub">
        Track tasks, habits, and calendar events in one place.
      </p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}

export interface SignInStepProps {
  email: string
  onEmailChange: (email: string) => void
  onContinue: () => void
}

export function SignInStep({ email, onEmailChange, onContinue }: SignInStepProps): ReactNode {
  return (
    <div className="welcome-step">
      <h1 className="welcome-headline">Sign in</h1>
      <div className="welcome-form">
        <Input
          value={email}
          onChange={onEmailChange}
          placeholder="you@example.com"
          ariaLabel="Email address"
          autoFocus
        />
        <Button variant="primary" onClick={onContinue} disabled={email.trim() === ''}>
          Continue with email
        </Button>
        <div className="welcome-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <Button variant="ghost" onClick={onContinue}>
          Continue with Apple
        </Button>
        <Button variant="ghost" onClick={onContinue}>
          Continue with Google
        </Button>
      </div>
    </div>
  )
}

export interface ConnectCalendarStepProps {
  connected: boolean
  onConnect: () => void
  onContinue: () => void
  onSkip: () => void
}

export function ConnectCalendarStep({
  connected,
  onConnect,
  onContinue,
  onSkip
}: ConnectCalendarStepProps): ReactNode {
  return (
    <div className="welcome-step">
      <h1 className="welcome-headline">Connect calendar</h1>
      <p className="welcome-sub">Connect Google Calendar to show events in Manor.</p>
      <div className={`welcome-connect${connected ? ' is-connected' : ''}`}>
        <span className="welcome-connect-icon">
          <CalendarDays size={18} />
        </span>
        <div className="welcome-connect-copy">
          <span className="welcome-connect-name">Google Calendar</span>
          <span className="welcome-connect-note">
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {connected ? (
          <span className="welcome-connect-check">
            <Check size={15} />
          </span>
        ) : (
          <Button variant="ghost" onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
      <div className="welcome-actions">
        {connected ? (
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        ) : (
          <button type="button" className="welcome-skip" onClick={onSkip}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  )
}

export interface PickHabitsStepProps {
  selected: ReadonlySet<string>
  onToggle: (name: string) => void
  onContinue: () => void
}

export function PickHabitsStep({ selected, onToggle, onContinue }: PickHabitsStepProps): ReactNode {
  return (
    <div className="welcome-step">
      <h1 className="welcome-headline">Choose habits</h1>
      <p className="welcome-sub">Pick a few habits to track. You can change these anytime.</p>
      <div className="welcome-chips" role="group" aria-label="Starting habits">
        {habits.map((habit) => {
          const on = selected.has(habit.name)
          return (
            <button
              key={habit.id}
              type="button"
              className={`welcome-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggle(habit.name)}
            >
              {on ? <Check size={13} /> : null}
              {habit.name}
            </button>
          )
        })}
      </div>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onContinue} disabled={selected.size === 0}>
          Continue
        </Button>
      </div>
    </div>
  )
}

export function HotkeyStep({ onFinish }: { onFinish: () => void }): ReactNode {
  return (
    <div className="welcome-step">
      <div className="welcome-orb">
        <ThinkingOrb size={72} state="idle" audioLevelRef={ZERO_AUDIO_LEVEL} />
      </div>
      <h1 className="welcome-headline">Meet Alfred</h1>
      <p className="welcome-sub">
        Press <Kbd keys={['⌥', 'Space']} /> from any app, then speak.
      </p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onFinish}>
          Open Manor
        </Button>
      </div>
    </div>
  )
}
