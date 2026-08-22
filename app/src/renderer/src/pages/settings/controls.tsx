import type { ReactNode } from 'react'

export interface SettingsRowProps {
  label: string
  /** One product-voice sentence; behavior explanations live here. */
  description: string
  children: ReactNode
}

/** Label + description on the left, control on the right (Linear anatomy). */
export function SettingsRow({ label, description, children }: SettingsRowProps): ReactNode {
  return (
    <div className="set-row">
      <div className="set-row-copy">
        <span className="set-row-label">{label}</span>
        <span className="set-row-desc">{description}</span>
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

export interface SettingsToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}

export function SettingsToggle({ checked, onChange, ariaLabel }: SettingsToggleProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`set-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="set-toggle-knob" />
    </button>
  )
}
