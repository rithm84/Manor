import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Pill } from './Pill'
import type { PillColorway } from './Pill'

export interface SelectOption {
  value: string
  label: string
  leading?: ReactNode
  tone?: PillColorway
}

export interface SelectProps {
  value: string | null
  options: readonly SelectOption[]
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}

/** Notion-style property dropdown shell: trigger + popover listbox. */
export function Select({ value, options, onChange, placeholder, ariaLabel }: SelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeAndFocus = useCallback((): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeAndFocus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeAndFocus, open])

  const selected = options.find((option) => option.value === value)
  const usesSemanticOptions = options.every((option) => option.tone !== undefined)

  const optionLabel = (option: SelectOption): ReactNode =>
    option.tone === undefined ? (
      <span className="ui-select-option-label">
        {option.leading}
        <span>{option.label}</span>
      </span>
    ) : (
      <Pill
        variant="tag"
        colorway={option.tone}
        label={option.label}
        icon={option.leading}
      />
    )

  return (
    <div className="ui-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-label={selected === undefined ? ariaLabel : `${ariaLabel}: ${selected.label}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {selected !== undefined ? (
          optionLabel(selected)
        ) : (
          <span className="ui-select-placeholder">{placeholder}</span>
        )}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div
          className={`ui-select-menu${usesSemanticOptions ? ' ui-select-menu--semantic' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`ui-select-option${option.value === value ? ' is-selected' : ''}`}
              onClick={() => {
                onChange(option.value)
                closeAndFocus()
              }}
            >
              {optionLabel(option)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
