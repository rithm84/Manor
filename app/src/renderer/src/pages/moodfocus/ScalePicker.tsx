import type { ReactNode } from 'react'

import type { ScaleOption } from './scales'

export interface ScalePickerProps<T extends string> {
  label: string
  options: readonly ScaleOption<T>[]
  value: T | null
  onChange: (value: T) => void
}

/** One row of big, calm tap targets; picking again deselects nothing (one per day). */
export function ScalePicker<T extends string>({
  label,
  options,
  value,
  onChange
}: ScalePickerProps<T>): ReactNode {
  return (
    <div className="mf-picker" role="radiogroup" aria-label={label}>
      <span className="mf-picker-label">{label}</span>
      <div className="mf-picker-options">
        {options.map((option) => {
          const Icon = option.icon
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`mf-option${selected ? ' is-selected' : ''}${
                value !== null && !selected ? ' is-dimmed' : ''
              }`}
              onClick={() => onChange(option.value)}
            >
              <Icon size={20} strokeWidth={1.8} />
              <span className="mf-option-label">{option.value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
