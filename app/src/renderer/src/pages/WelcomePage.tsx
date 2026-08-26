import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { BrandMark } from '../components/BrandMark'
import { localTodayIso } from './home/taskModel'
import {
  ConnectCalendarStep,
  HotkeyStep,
  PickHabitsStep,
  SignInStep,
  WelcomeIntro
} from './welcome/steps'
import './welcome/welcome.css'

const STEP_COUNT = 5

const STEP_LABELS = ['Welcome', 'Sign in', 'Calendar', 'Habits', 'Alfred'] as const

/**
 * First run: welcome, sign in, connect calendar, pick starting habits,
 * meet the hotkey. Frameless (no sidebar). Sign-in talks to the real
 * account API; the remaining controls are mock and local. Earlier steps
 * are reachable via the stepper dots or the Back button beside them.
 */
export function WelcomePage(): ReactNode {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [pickedHabits, setPickedHabits] = useState<ReadonlySet<string>>(new Set())
  const [finishBusy, setFinishBusy] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  const next = (): void => setStep(Math.min(STEP_COUNT - 1, step + 1))

  // Finishing creates the picked habits for real, then marks this machine
  // welcomed so the first-run redirect never routes here again.
  const finish = async (): Promise<void> => {
    if (finishBusy) return
    setFinishBusy(true)
    setFinishError(null)
    try {
      // A fresh account starts with ONLY the picked habits: initializing the
      // store empty configures its current date and blocks the demo seed.
      await window.manor.habits.load({
        today: localTodayIso(new Date()),
        habits: [],
        lifecycle: [],
        entries: [],
        freezes: [],
        grants: [],
        finalizedDays: [],
        monthCapacities: {}
      })
      for (const name of pickedHabits) {
        await window.manor.habits.createHabit({ name, kind: 'binary', targetLabel: null })
      }
      window.localStorage.setItem('manor.welcomed', '1')
      void navigate('/home')
    } catch (error) {
      console.error('Onboarding habit creation failed', { error })
      setFinishBusy(false)
      setFinishError(
        error instanceof Error ? error.message : 'Your habits could not be created. Try again.'
      )
    }
  }

  const back = (): void => setStep(Math.max(0, step - 1))

  const toggleHabit = (name: string): void => {
    const nextSet = new Set(pickedHabits)
    if (nextSet.has(name)) {
      nextSet.delete(name)
    } else {
      nextSet.add(name)
    }
    setPickedHabits(nextSet)
  }

  return (
    <div className="welcome titlebar-drag">
      <span className="welcome-wordmark">
        <BrandMark className="welcome-brand-mark" />
        Manor
      </span>
      <div className="welcome-stage" key={step}>
        {step === 0 ? <WelcomeIntro onContinue={next} /> : null}
        {step === 1 ? (
          <SignInStep email={email} onEmailChange={setEmail} onContinue={next} />
        ) : null}
        {step === 2 ? (
          <ConnectCalendarStep
            connected={calendarConnected}
            onConnect={() => setCalendarConnected(true)}
            onContinue={next}
            onSkip={next}
          />
        ) : null}
        {step === 3 ? (
          <PickHabitsStep selected={pickedHabits} onToggle={toggleHabit} onContinue={next} />
        ) : null}
        {step === 4 ? (
          <>
            <HotkeyStep onFinish={() => void finish()} />
            {finishError !== null ? (
              <span className="welcome-field-error" role="alert">{finishError}</span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="welcome-stepper">
        {step > 0 ? (
          <button type="button" className="welcome-back" onClick={back}>
            Back
          </button>
        ) : null}
        <div className="welcome-dots" role="tablist" aria-label="Setup steps">
          {STEP_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={index === step}
              aria-label={label}
              className={`welcome-dot${index === step ? ' is-active' : ''}`}
              onClick={() => setStep(index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
