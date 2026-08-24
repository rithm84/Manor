import type { ReactNode } from 'react'

export interface CheckboxProps {
  /** 'round' = habit-style. 'square' = task-style. Both use completion green. */
  shape: 'round' | 'square'
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  ariaLabel?: string
}

export function Checkbox({ shape, checked, onChange, label, ariaLabel }: CheckboxProps): ReactNode {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      className={`ui-checkbox ui-checkbox--${shape}${checked ? ' is-checked' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-checkbox-box" aria-hidden="true">
        {/* Hand-drawn stroke: dips into the bowl, then flicks up past the corner. */}
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path
            className="ui-checkbox-check"
            d="M2.1 6.8 C3.2 7.3 4.1 8.4 4.6 9.3 C5.5 7.2 7.6 4.3 10.3 2.4"
          />
        </svg>
      </span>
      {label !== undefined ? <span className="ui-checkbox-label">{label}</span> : null}
    </button>
  )
}
