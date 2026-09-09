import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { useDismissLayer } from './dismissLayer'
import { clampMenuPosition } from './menuPosition'
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const selected = options.find((option) => option.value === value)
  const usesSemanticOptions = options.every((option) => option.tone !== undefined)

  const closeAndFocus = useCallback((): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  // Semantic menus size to their pills; plain menus stretch to the trigger.
  const updatePosition = useCallback((): void => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (trigger === null || menu === null) return
    const triggerRect = trigger.getBoundingClientRect()
    const menuWidth = usesSemanticOptions
      ? menu.offsetWidth
      : Math.max(menu.offsetWidth, triggerRect.width)
    const { left, top } = clampMenuPosition(triggerRect, menuWidth, menu.offsetHeight)
    setMenuStyle(usesSemanticOptions ? { left, top } : { left, top, minWidth: triggerRect.width })
  }, [usesSemanticOptions])

  useLayoutEffect(() => {
    if (open) updatePosition()
    else setMenuStyle(null)
  }, [open, updatePosition])

  useDismissLayer(open, closeAndFocus)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onViewportChange = (): void => updatePosition()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, updatePosition])

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
          ref={menuRef}
          className={`ui-select-menu${usesSemanticOptions ? ' ui-select-menu--semantic' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle ?? undefined}
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
