import type { ReactNode } from 'react'

export interface CheckboxProps {
  /** 'round' = habit-style (green fill). 'square' = task-style (coral fill). */
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
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path className="ui-checkbox-check" d="M2 6.2 L4.8 9 L10 3.2" />
        </svg>
      </span>
      {label !== undefined ? <span className="ui-checkbox-label">{label}</span> : null}
    </button>
  )
}
