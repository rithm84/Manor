import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface SelectOption {
  value: string
  label: string
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
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selected = options.find((option) => option.value === value)

  return (
    <div className="ui-select" ref={rootRef}>
      <button
        type="button"
        className="ui-select-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {selected !== undefined ? (
          selected.label
        ) : (
          <span className="ui-select-placeholder">{placeholder}</span>
        )}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="ui-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`ui-select-option${option.value === value ? ' is-selected' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
