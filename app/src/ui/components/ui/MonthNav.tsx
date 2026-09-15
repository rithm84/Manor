import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Tooltip } from './Tooltip'

export interface MonthNavProps {
  /** Accessible name for the group, such as "History month". */
  label: string
  /** The shown month's name, such as "September 2026". */
  monthLabel: string
  canMoveBack: boolean
  canMoveForward: boolean
  /** Moves one month back (-1) or forward (1). */
  onShift: (direction: -1 | 1) => void
  /** Returns to the current month; omit or pass null when it is already shown. */
  onCurrent?: (() => void) | null
}

/**
 * The month stepper shared by the module history views. Left and Right move a
 * month while the group has focus, and the month name is a button back to the
 * current month whenever another month is shown.
 */
export function MonthNav({ label, monthLabel, canMoveBack, canMoveForward, onShift, onCurrent = null }: MonthNavProps): ReactNode {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft' && canMoveBack) {
      event.preventDefault()
      onShift(-1)
    } else if (event.key === 'ArrowRight' && canMoveForward) {
      event.preventDefault()
      onShift(1)
    }
  }

  return (
    <div className="ui-monthnav" role="group" aria-label={label} onKeyDown={onKeyDown}>
      <button type="button" aria-label="Previous month" disabled={!canMoveBack} onClick={() => onShift(-1)}>
        <ChevronLeft size={16} />
      </button>
      {onCurrent === null ? (
        <span className="ui-monthnav-label" aria-live="polite">{monthLabel}</span>
      ) : (
        <Tooltip label="Back to this month" side="bottom">
          <button type="button" className="ui-monthnav-label is-link" aria-live="polite" onClick={onCurrent}>
            {monthLabel}
          </button>
        </Tooltip>
      )}
      <button type="button" aria-label="Next month" disabled={!canMoveForward} onClick={() => onShift(1)}>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
