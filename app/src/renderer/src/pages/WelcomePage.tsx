import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { BrandMark } from '../components/BrandMark'
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
 * meet the hotkey. Frameless (no sidebar); every control is mock and
 * local. The stepper is clickable for revisiting earlier steps.
 */
export function WelcomePage(): ReactNode {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [pickedHabits, setPickedHabits] = useState<ReadonlySet<string>>(new Set())

  const next = (): void => setStep(Math.min(STEP_COUNT - 1, step + 1))

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
          <HotkeyStep
            onFinish={() => {
              void navigate('/home')
            }}
          />
        ) : null}
      </div>
      <div className="welcome-stepper" role="tablist" aria-label="Setup steps">
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
  )
}
