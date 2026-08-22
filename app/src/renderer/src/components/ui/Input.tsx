import type { ReactNode } from 'react'

export interface InputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Leading icon (16px lucide). */
  icon?: ReactNode
  ariaLabel: string
  autoFocus?: boolean
}

export function Input({ value, onChange, placeholder, icon, ariaLabel, autoFocus }: InputProps): ReactNode {
  return (
    <span className="ui-input-wrap">
      {icon !== undefined ? <span className="ui-input-icon">{icon}</span> : null}
      <input
        type="text"
        className={`ui-input${icon !== undefined ? ' ui-input--with-icon' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus === true}
      />
    </span>
  )
}
