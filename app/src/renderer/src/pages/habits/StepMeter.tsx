import type { ReactNode } from 'react'

import { Tooltip } from '../../components/ui'
import { stepAmountLabel } from './habitModel'

export interface StepMeterProps {
  steps: readonly number[]
  value: number
  targetLabel: string
  onChange: (value: number) => void
}

/**
 * Five-stop fill control for habits logged in steps. Clicking a segment fills
 * to that stop; clicking the current stop drops back one, so it can be undone.
 */
export function StepMeter({ steps, value, targetLabel, onChange }: StepMeterProps): ReactNode {
  const fillable = steps.filter((step) => step > 0)
  return (
    <div className="habit-stepmeter" role="group" aria-label={`Progress toward ${targetLabel}`}>
      <div className="habit-stepmeter-track">
        {fillable.map((step, index) => {
          const previous = index === 0 ? 0 : fillable[index - 1]
          const filled = value >= step
          return (
            <Tooltip key={step} label={stepAmountLabel(targetLabel, step)} side="top">
              <button
                type="button"
                className={`habit-stepmeter-seg${filled ? ' is-filled' : ''}`}
                aria-label={`Set to ${stepAmountLabel(targetLabel, step)}`}
                aria-pressed={filled}
                onClick={() => onChange(value === step ? previous : step)}
              />
            </Tooltip>
          )
        })}
      </div>
      <span className="habit-stepmeter-label tnum">{stepAmountLabel(targetLabel, value)}</span>
    </div>
  )
}
