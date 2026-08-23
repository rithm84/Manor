import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'

import type {
  ContextColor,
  ContextDefinition,
  ContextDraft,
  ContextIcon
} from '../../../../shared/home'
import { ContextPill } from './ContextPill'
import {
  CONTEXT_ICON_CATEGORIES,
  CONTEXT_ICON_OPTIONS,
  ContextGlyph,
  contextIconLabel
} from './contextIcons'
import { contextDefinitionFor } from './taskModel'

export interface ContextSelectProps {
  value: string | null
  contexts: readonly ContextDefinition[]
  onChange: (context: string) => void
  onAdd: (context: ContextDraft) => Promise<ContextDefinition>
  placeholder: string
  ariaLabel: string
}

export const CONTEXT_COLOR_OPTIONS: readonly { value: ContextColor; label: string }[] = [
  { value: 'forest', label: 'Forest' },
  { value: 'success', label: 'Sage' },
  { value: 'gold', label: 'Gold' },
  { value: 'info', label: 'Blue' },
  { value: 'plum', label: 'Plum' },
  { value: 'today', label: 'Amber' }
]

type ContextPropertyPicker = 'icon' | 'color'
type ContextPickerPlacement = 'above' | 'below'

function useContextPickerPlacement(): readonly [RefObject<HTMLDivElement | null>, ContextPickerPlacement] {
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<ContextPickerPlacement>('below')

  useLayoutEffect(() => {
    const picker = pickerRef.current
    const trigger = picker?.parentElement
    if (picker === null || picker === undefined || trigger === null || trigger === undefined) return

    const clippingRoot = picker.closest<HTMLElement>('.task-detail-body, .ui-modal')
    const boundary = clippingRoot?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight
    }
    const triggerRect = trigger.getBoundingClientRect()
    const pickerHeight = picker.getBoundingClientRect().height
    const spaceBelow = boundary.bottom - triggerRect.bottom
    const spaceAbove = triggerRect.top - boundary.top
    setPlacement(spaceBelow < pickerHeight + 8 && spaceAbove > spaceBelow ? 'above' : 'below')
  }, [])

  return [pickerRef, placement]
}

function movePickerFocus(
  event: KeyboardEvent<HTMLButtonElement>,
  pickerSelector: string
): void {
  const picker = event.currentTarget.closest(pickerSelector)
  if (picker === null) return
  const options = Array.from(picker.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  const currentIndex = options.indexOf(event.currentTarget)
  if (currentIndex === -1) return

  let nextIndex: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % options.length
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + options.length) % options.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = options.length - 1
  }

  if (nextIndex === null) return
  event.preventDefault()
  options[nextIndex]?.focus()
}

interface ContextIconPickerProps {
  value: ContextIcon
  onChange: (value: ContextIcon) => void
  onClose: () => void
}

function ContextIconPicker({ value, onChange, onClose }: ContextIconPickerProps): ReactNode {
  const [query, setQuery] = useState('')
  const [pickerRef, placement] = useContextPickerPlacement()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingIcons = CONTEXT_ICON_OPTIONS.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedQuery)
  )

  return (
    <div
      ref={pickerRef}
      className={`context-property-picker context-icon-picker is-${placement}`}
      role="dialog"
      aria-label="Choose context icon"
    >
      <div className="context-picker-search">
        <Search size={13} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Search icons"
          aria-label="Search context icons"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" aria-label="Close icon picker" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="context-icon-catalog" role="radiogroup" aria-label="Context icons">
        {normalizedQuery === '' ? (
          CONTEXT_ICON_CATEGORIES.map((category) => {
            const categoryId = `context-icons-${category.toLocaleLowerCase()}`
            return (
              <div key={category} className="context-icon-category" role="group" aria-labelledby={categoryId}>
                <span id={categoryId}>{category}</span>
                <div className="context-icon-grid">
                  {CONTEXT_ICON_OPTIONS.filter((option) => option.category === category).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={value === option.value}
                      aria-label={option.label}
                      title={option.label}
                      className={value === option.value ? 'is-selected' : ''}
                      onKeyDown={(event) => movePickerFocus(event, '.context-icon-picker')}
                      onClick={() => onChange(option.value)}
                    >
                      <ContextGlyph icon={option.value} size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        ) : matchingIcons.length > 0 ? (
          <div className="context-icon-grid context-icon-grid--results">
            {matchingIcons.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={value === option.value}
                aria-label={option.label}
                title={option.label}
                className={value === option.value ? 'is-selected' : ''}
                onKeyDown={(event) => movePickerFocus(event, '.context-icon-picker')}
                onClick={() => onChange(option.value)}
              >
                <ContextGlyph icon={option.value} size={15} />
              </button>
            ))}
          </div>
        ) : (
          <span className="context-picker-empty">No matching icons.</span>
        )}
      </div>
    </div>
  )
}

interface ContextColorPickerProps {
  value: ContextColor
  onChange: (value: ContextColor) => void
}

function ContextColorPicker({ value, onChange }: ContextColorPickerProps): ReactNode {
  const [pickerRef, placement] = useContextPickerPlacement()

  return (
    <div
      ref={pickerRef}
      className={`context-property-picker context-color-picker is-${placement}`}
      role="radiogroup"
      aria-label="Context color"
    >
      {CONTEXT_COLOR_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-selected' : ''}
          onKeyDown={(event) => movePickerFocus(event, '.context-color-picker')}
          onClick={() => onChange(option.value)}
        >
          <span className={`context-color-swatch is-${option.value}`} aria-hidden="true" />
          <span>{option.label}</span>
          {value === option.value ? <Check size={13} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  )
}

export function ContextSelect({
  value,
  contexts,
  onChange,
  onAdd,
  placeholder,
  ariaLabel
}: ContextSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<ContextColor>('plum')
  const [draftIcon, setDraftIcon] = useState<ContextIcon>('target')
  const [propertyPicker, setPropertyPicker] = useState<ContextPropertyPicker | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null)
  const colorTriggerRef = useRef<HTMLButtonElement | null>(null)

  const closeAndFocus = useCallback((): void => {
    setOpen(false)
    setPropertyPicker(null)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const closePropertyPicker = useCallback((picker: ContextPropertyPicker): void => {
    setPropertyPicker(null)
    window.requestAnimationFrame(() => {
      if (picker === 'icon') iconTriggerRef.current?.focus()
      else colorTriggerRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setPropertyPicker(null)
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (propertyPicker !== null) {
        event.preventDefault()
        closePropertyPicker(propertyPicker)
        return
      }
      closeAndFocus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeAndFocus, closePropertyPicker, open, propertyPicker])

  const add = async (): Promise<void> => {
    const next = draft.trim()
    if (next === '') return
    try {
      const context = await onAdd({ name: next, color: draftColor, icon: draftIcon })
      onChange(context.name)
      setDraft('')
      setDraftColor('plum')
      setDraftIcon('target')
      setError(null)
      closeAndFocus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add context')
    }
  }

  const selectedContext = value === null ? null : contextDefinitionFor(value, contexts)

  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void add()
    }
  }

  const selectedColorLabel = CONTEXT_COLOR_OPTIONS.find(
    (option) => option.value === draftColor
  )?.label

  return (
    <div className="context-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-label={value === null ? ariaLabel : `${ariaLabel}: ${value}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
          setPropertyPicker(null)
        }}
      >
        {selectedContext === null ? (
          <span className="ui-select-placeholder">{placeholder}</span>
        ) : (
          <ContextPill name={selectedContext.name} contexts={contexts} />
        )}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="context-menu" role="dialog" aria-label={ariaLabel}>
          {propertyPicker === null ? (
            <div className="context-options" role="listbox" aria-label="Contexts">
              {contexts.map((context) => (
                <button
                  key={context.name}
                  type="button"
                  role="option"
                  aria-selected={context.name === value}
                  className={`context-option${context.name === value ? ' is-selected' : ''}`}
                  onClick={() => {
                    onChange(context.name)
                    closeAndFocus()
                  }}
                >
                  <ContextPill name={context.name} contexts={contexts} />
                  {context.name === value ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="context-add">
            <div className="context-composer">
              <input
                value={draft}
                maxLength={48}
                placeholder="New context"
                aria-label="New context"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onDraftKeyDown}
              />
              <div className="context-property-control">
                <button
                  ref={iconTriggerRef}
                  type="button"
                  className="context-property-trigger"
                  aria-label={`Context icon: ${contextIconLabel(draftIcon)}`}
                  aria-haspopup="dialog"
                  aria-expanded={propertyPicker === 'icon'}
                  title="Choose icon"
                  onClick={() => setPropertyPicker((current) => current === 'icon' ? null : 'icon')}
                >
                  <ContextGlyph icon={draftIcon} size={14} />
                </button>
                {propertyPicker === 'icon' ? (
                  <ContextIconPicker
                    value={draftIcon}
                    onChange={(icon) => {
                      setDraftIcon(icon)
                      closePropertyPicker('icon')
                    }}
                    onClose={() => closePropertyPicker('icon')}
                  />
                ) : null}
              </div>
              <div className="context-property-control">
                <button
                  ref={colorTriggerRef}
                  type="button"
                  className="context-property-trigger"
                  aria-label={`Context color: ${selectedColorLabel ?? draftColor}`}
                  aria-haspopup="dialog"
                  aria-expanded={propertyPicker === 'color'}
                  title="Choose color"
                  onClick={() => setPropertyPicker((current) => current === 'color' ? null : 'color')}
                >
                  <span className={`context-color-swatch is-${draftColor}`} aria-hidden="true" />
                </button>
                {propertyPicker === 'color' ? (
                  <ContextColorPicker
                    value={draftColor}
                    onChange={(color) => {
                      setDraftColor(color)
                      closePropertyPicker('color')
                    }}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className="context-create-button"
                aria-label="Create context"
                disabled={draft.trim() === ''}
                onClick={() => void add()}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
          {error !== null ? <span className="context-error">{error}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
