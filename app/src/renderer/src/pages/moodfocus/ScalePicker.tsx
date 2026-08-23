import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

import type { ScaleOption } from './scales'

export interface ScalePickerProps<T extends string> {
  id: string
  step: string
  label: string
  hint: string
  kind: 'mood' | 'focus'
  options: readonly ScaleOption<T>[]
  value: T | null
  disabled: boolean
  onChange: (value: T) => void
}

type ScaleOptionStyle = CSSProperties & {
  '--option-tone': string
  '--option-tint': string
}

export function ScalePicker<T extends string>({
  id,
  step,
  label,
  hint,
  kind,
  options,
  value,
  disabled,
  onChange
}: ScalePickerProps<T>): ReactNode {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value)

  const chooseFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index + (forward ? 1 : -1) + options.length) % options.length
    const next = options[nextIndex]
    if (next === undefined) {
      throw new Error(`${label} scale is missing option ${nextIndex}`)
    }
    onChange(next.value)
    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <fieldset className={`mf-picker is-${kind}`} disabled={disabled}>
      <legend id={`${id}-label`} className="mf-picker-legend">
        <span className="mf-picker-step" aria-hidden="true">{step}</span>
        <span>
          <span className="mf-picker-kicker">{label}</span>
          <span className="mf-picker-hint">{hint}</span>
        </span>
      </legend>
      <div className="mf-picker-options" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map((option, index) => {
          const Icon = option.icon
          const selected = value === option.value
          const style: ScaleOptionStyle = {
            '--option-tone': option.tone.strong,
            '--option-tint': option.tone.tint
          }
          return (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selectedIndex === -1 ? (index === 0 ? 0 : -1) : selected ? 0 : -1}
              className={`mf-option is-${kind} level-${option.level}${selected ? ' is-selected' : ''}`}
              data-testid={`${id}-${option.value.toLowerCase().replaceAll(' ', '-')}`}
              style={style}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => chooseFromKeyboard(event, index)}
            >
              <span className="mf-option-mark" aria-hidden="true">
                <Icon size={19} strokeWidth={1.7} />
              </span>
              <span className="mf-option-label">{option.value}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
