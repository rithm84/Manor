import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { habitSteps, nearestStep } from '../../../shared/habits'
import { stepAmountLabel } from './habitModel'

/**
 * The percent ladder a habit logs through: 0 plus one step per unit when the
 * target reads "N units" (up to 8), 0/25/50/75/100 otherwise (shared
 * habitSteps rule). Cycling wraps at both ends.
 */
export function habitLadder(targetLabel: string): readonly number[] {
  return [0, ...habitSteps(targetLabel)]
}

function shiftedValue(ladder: readonly number[], value: number, offset: -1 | 1): number {
  const currentIndex = ladder.indexOf(value)
  if (currentIndex === -1) {
    throw new RangeError(`Habit value ${value} is not on the ladder ${ladder.join(', ')}`)
  }
  return ladder[(currentIndex + offset + ladder.length) % ladder.length]
}

/** Entries written before a target change may sit between steps; snap to the
    nearest ladder value so the control always cycles from solid ground. */
export function nearestLadderValue(ladder: readonly number[], value: number): number {
  return nearestStep(ladder, value)
}

function checkedState(value: number): boolean | 'mixed' {
  if (value === 0) return false
  if (value === 100) return true
  return 'mixed'
}

export interface QuantizedHabitControlProps {
  habitId: string
  habitName: string
  targetLabel: string
  value: number
  /** Persists the value; the control steps optimistically and reconciles on resolve. */
  onChange: (value: number) => Promise<void>
}

export function QuantizedHabitControl({
  habitId,
  habitName,
  targetLabel,
  value,
  onChange
}: QuantizedHabitControlProps): ReactNode {
  // Rapid steps read this local value instead of waiting for the server round
  // trip. Once every in-flight write settles, the persisted prop takes over
  // again, which also reverts the control when a write failed (the page-level
  // error banner reports the failure).
  const [optimistic, setOptimistic] = useState<number | null>(null)
  const inFlight = useRef(0)
  const ladder = habitLadder(targetLabel)
  const shown = nearestLadderValue(ladder, optimistic ?? value)
  const forwardValue = shiftedValue(ladder, shown, 1)
  const backwardValue = shiftedValue(ladder, shown, -1)
  const currentAmount = stepAmountLabel(targetLabel, shown)

  const step = (next: number): void => {
    setOptimistic(next)
    inFlight.current += 1
    void onChange(next).finally(() => {
      inFlight.current -= 1
      if (inFlight.current === 0) {
        setOptimistic(null)
      }
    })
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    step(event.shiftKey ? backwardValue : forwardValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }
    event.preventDefault()
    step(event.key === 'ArrowUp' ? forwardValue : backwardValue)
  }

  const fillStyle = { '--habit-fill-angle': `${(shown / 100) * 360}deg` } as CSSProperties

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checkedState(shown)}
      aria-label={`${habitName}: ${shown}% complete, ${currentAmount}. Activate or arrow up to set ${forwardValue}%. Shift plus activate or arrow down to set ${backwardValue}%.`}
      className={`habit-quantized-control${shown === 100 ? ' is-complete' : ''}`}
      style={fillStyle}
      data-testid={`habit-progress-${habitId}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="habit-quantized-control-value tnum" aria-hidden="true">
        {shown === 100 ? <Check size={13} strokeWidth={2.4} /> : shown}
      </span>
    </button>
  )
}
