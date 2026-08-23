import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { stepAmountLabel } from './habitModel'

export type QuantizedValue = 0 | 25 | 50 | 75 | 100

const QUANTIZED_VALUES: readonly QuantizedValue[] = [0, 25, 50, 75, 100]

export function nextQuantizedValue(value: QuantizedValue): QuantizedValue {
  const currentIndex = QUANTIZED_VALUES.indexOf(value)
  if (currentIndex === -1) {
    throw new RangeError(`Cannot cycle unsupported quantized habit value: ${value}`)
  }

  return QUANTIZED_VALUES[(currentIndex + 1) % QUANTIZED_VALUES.length]
}

function checkedState(value: QuantizedValue): boolean | 'mixed' {
  if (value === 0) return false
  if (value === 100) return true
  return 'mixed'
}

export interface QuantizedHabitControlProps {
  gold: boolean
  habitId: string
  habitName: string
  targetLabel: string
  value: QuantizedValue
  onChange: (value: QuantizedValue) => void
}

export function QuantizedHabitControl({
  gold,
  habitId,
  habitName,
  targetLabel,
  value,
  onChange
}: QuantizedHabitControlProps): ReactNode {
  const nextValue = nextQuantizedValue(value)
  const currentAmount = stepAmountLabel(targetLabel, value)

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checkedState(value)}
      aria-label={`${habitName}: ${value}% complete, ${currentAmount}.${gold ? ' Gold streak.' : ''} Activate to set ${nextValue}%.`}
      className={`habit-quantized-control is-quarter-${value / 25}${gold ? ' is-gold' : ''}`}
      data-testid={`habit-progress-${habitId}`}
      onClick={() => onChange(nextValue)}
    >
      <span className="habit-quantized-control-value tnum" aria-hidden="true">
        {value === 100 ? <Check size={13} strokeWidth={2.4} /> : value}
      </span>
    </button>
  )
}
