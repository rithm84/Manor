import { CalendarDays, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { ThinkingOrb } from '../../components/orb/ThinkingOrb'
import { Button, Kbd } from '../../components/ui'
import { habits } from '../../data/mock'
import { calendarApi, useGoogleConnect } from '../settings/useGoogleConnect'
import { accountErrorMessage, useCurrentAccount, useSignIn, validateSignIn } from './accountSession'

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
  const { account, setAccount } = useCurrentAccount()
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const signIn = useSignIn(() => onContinue())

  const submitCredentials = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const problem = validateSignIn(email, password)
    if (problem !== null) {
      setFieldError(problem)
      return
    }
    setFieldError(null)
    if (mode === 'sign-in') {
      signIn.submit(email, password)
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    window.manor.account
      .signUp({ email: email.trim(), password })
      .then(() => {
        setCreateBusy(false)
        onContinue()
      })
      .catch((cause: unknown) => {
        console.error('Account creation failed', { error: cause })
        setCreateBusy(false)
        setCreateError(accountErrorMessage(cause, 'Account creation failed. Try again.'))
      })
  }

  const useDifferentAccount = (): void => {
    setSwitching(true)
    setSwitchError(null)
    window.manor.account
      .signOut()
      .then(() => {
        setSwitching(false)
        setAccount(null)
      })
      .catch((cause: unknown) => {
        console.error('Sign out failed', { error: cause })
        setSwitching(false)
        setSwitchError(accountErrorMessage(cause, 'Sign out failed. Try again.'))
      })
  }

  if (account === undefined) {
    return (
      <div className="welcome-step">
        <h1 className="welcome-headline">Sign in</h1>
        <div className="welcome-form" aria-hidden="true">
          <span className="welcome-form-ghost" />
          <span className="welcome-form-ghost" />
          <span className="welcome-form-ghost welcome-form-ghost--button" />
        </div>
      </div>
    )
  }

  if (account !== null) {
    return (
      <div className="welcome-step">
        <h1 className="welcome-headline">Welcome back</h1>
        <p className="welcome-sub">You&rsquo;re signed in.</p>
        {switchError !== null ? (
          <span className="welcome-field-error" role="alert">
            {switchError}
          </span>
        ) : null}
        <div className="welcome-actions">
          <Button variant="primary" onClick={onContinue} disabled={switching}>
            Continue as {account.email}
          </Button>
          <button
            type="button"
            className="welcome-skip"
            onClick={useDifferentAccount}
            disabled={switching}
          >
            Use a different account
          </button>
        </div>
      </div>
    )
  }

  const inlineError = fieldError ?? (mode === 'create' ? createError : signIn.error)
  const busy = mode === 'create' ? createBusy : signIn.busy

  return (
    <div className="welcome-step">
      <h1 className="welcome-headline">{mode === 'create' ? 'Create your account' : 'Sign in'}</h1>
      <form className="welcome-form" onSubmit={submitCredentials} noValidate>
        <span className="ui-input-wrap">
          <input
            type="email"
            className="ui-input"
            value={email}
            onChange={(event) => {
              onEmailChange(event.target.value)
              setFieldError(null)
              signIn.clearError()
            }}
            placeholder="you@example.com"
            aria-label="Email address"
            aria-invalid={inlineError !== null}
            autoComplete="email"
            autoFocus
          />
        </span>
        <span className="ui-input-wrap">
          <input
            type="password"
            className="ui-input"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setFieldError(null)
              signIn.clearError()
            }}
            placeholder="Password"
            aria-label="Password"
            autoComplete="current-password"
          />
        </span>
        {inlineError !== null ? (
          <span className="welcome-field-error" role="alert">
            {inlineError}
          </span>
        ) : null}
        <button
          type="submit"
          className="ui-button ui-button--primary"
          disabled={email.trim() === '' || password === '' || busy}
        >
          {mode === 'create'
            ? createBusy
              ? 'Creating account…'
              : 'Create account'
            : signIn.busy
              ? 'Signing in…'
              : 'Sign in'}
        </button>
        <button
          type="button"
          className="welcome-skip"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'create' ? 'sign-in' : 'create')
            setFieldError(null)
            setCreateError(null)
            signIn.clearError()
          }}
        >
          {mode === 'create' ? 'Have an account? Sign in' : 'New to Manor? Create an account'}
        </button>
      </form>
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
  const connect = useGoogleConnect(() => onConnect())

  // Mount-only probe: an account connected earlier (or in Settings) marks the
  // step done. Unavailability here just leaves the step unconnected.
  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => calendarApi().accounts())
      .then((accounts) => {
        if (!cancelled && accounts.length > 0) onConnect()
      })
      .catch((error: unknown) => {
        console.warn('Connected calendar check failed', { error })
      })
    return (): void => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            {connected ? 'Connected' : connect.busy ? 'Waiting for Google' : 'Not connected'}
          </span>
        </div>
        {connected ? (
          <span className="welcome-connect-check">
            <Check size={15} />
          </span>
        ) : (
          <Button variant="ghost" onClick={connect.start} disabled={connect.busy}>
            {connect.busy ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>
      {connect.error !== null ? (
        <span className="welcome-field-error" role="alert">
          {connect.error}
        </span>
      ) : null}
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
        Press <Kbd keys={['⌥', 'M']} /> from any app, then speak.
      </p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onFinish}>
          Open Manor
        </Button>
      </div>
    </div>
  )
}
