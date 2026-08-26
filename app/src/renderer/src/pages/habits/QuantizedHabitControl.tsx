import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

import { stepAmountLabel } from './habitModel'

export type QuantizedValue = 0 | 25 | 50 | 75 | 100

const QUANTIZED_VALUES: readonly QuantizedValue[] = [0, 25, 50, 75, 100]

function shiftedQuantizedValue(value: QuantizedValue, offset: -1 | 1): QuantizedValue {
  const currentIndex = QUANTIZED_VALUES.indexOf(value)
  if (currentIndex === -1) {
    throw new RangeError(`Cannot cycle unsupported quantized habit value: ${value}`)
  }

  return QUANTIZED_VALUES[
    (currentIndex + offset + QUANTIZED_VALUES.length) % QUANTIZED_VALUES.length
  ]
}

export function nextQuantizedValue(value: QuantizedValue): QuantizedValue {
  return shiftedQuantizedValue(value, 1)
}

export function previousQuantizedValue(value: QuantizedValue): QuantizedValue {
  return shiftedQuantizedValue(value, -1)
}

function checkedState(value: QuantizedValue): boolean | 'mixed' {
  if (value === 0) return false
  if (value === 100) return true
  return 'mixed'
}

export interface QuantizedHabitControlProps {
  habitId: string
  habitName: string
  targetLabel: string
  value: QuantizedValue
  /** Persists the value; the control steps optimistically and reconciles on resolve. */
  onChange: (value: QuantizedValue) => Promise<void>
}

export function QuantizedHabitControl({
  habitId,
  habitName,
  targetLabel,
  value,
  onChange
}: QuantizedHabitControlProps): ReactNode {
  // Rapid steps read this local value instead of waiting for the IPC round
  // trip. Once every in-flight write settles, the persisted prop takes over
  // again, which also reverts the control when a write failed (the page-level
  // error banner reports the failure).
  const [optimistic, setOptimistic] = useState<QuantizedValue | null>(null)
  const inFlight = useRef(0)
  const shown = optimistic ?? value
  const forwardValue = nextQuantizedValue(shown)
  const backwardValue = previousQuantizedValue(shown)
  const currentAmount = stepAmountLabel(targetLabel, shown)

  const step = (next: QuantizedValue): void => {
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

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checkedState(shown)}
      aria-label={`${habitName}: ${shown}% complete, ${currentAmount}. Activate or arrow up to set ${forwardValue}%. Shift plus activate or arrow down to set ${backwardValue}%.`}
      className={`habit-quantized-control is-quarter-${shown / 25}`}
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
