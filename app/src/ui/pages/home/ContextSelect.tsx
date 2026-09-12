import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import type { ContextColor, ContextDefinition, ContextDraft, ContextIcon } from '../../../shared/home'
import { accountErrorMessage } from '../welcome/accountSession'
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
  onUpdate: (originalName: string, context: ContextDraft) => Promise<ContextDefinition>
  onDelete: (name: string) => Promise<void>
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

function moveGridFocus(event: KeyboardEvent<HTMLButtonElement>, selector: string): void {
  const grid = event.currentTarget.closest(selector)
  if (grid === null) return
  const options = Array.from(grid.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  const currentIndex = options.indexOf(event.currentTarget)
  if (currentIndex === -1) return
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    ? 1
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : 0
  if (delta === 0) return
  event.preventDefault()
  options[(currentIndex + delta + options.length) % options.length]?.focus()
}

export function ContextSelect({
  value,
  contexts,
  onChange,
  onAdd,
  onUpdate,
  onDelete,
  placeholder,
  ariaLabel
}: ContextSelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<ContextColor>('plum')
  const [draftIcon, setDraftIcon] = useState<ContextIcon>('target')
  const [editing, setEditing] = useState<string | null>(null)
  const [propertyPicker, setPropertyPicker] = useState<ContextPropertyPicker | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const selectedContext = value === null ? null : contextDefinitionFor(value, contexts)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingContexts = contexts.filter((context) =>
    context.name.toLocaleLowerCase().includes(normalizedQuery)
  )

  const resetComposer = (): void => {
    setEditing(null)
    setDraft('')
    setDraftColor('plum')
    setDraftIcon('target')
    setPropertyPicker(null)
  }

  const beginEdit = (context: ContextDefinition): void => {
    setEditing(context.name)
    setDraft(context.name)
    setDraftColor(context.color)
    setDraftIcon(context.icon)
    setPropertyPicker(null)
    setError(null)
  }

  const saveContext = async (): Promise<void> => {
    const nextName = draft.trim()
    if (nextName === '' || adding) return
    setAdding(true)
    setError(null)
    try {
      const context = editing === null
        ? await onAdd({ name: nextName, color: draftColor, icon: draftIcon })
        : await onUpdate(editing, { name: nextName, color: draftColor, icon: draftIcon })
      if (editing === null || editing === value) onChange(context.name)
      resetComposer()
      setOpen(false)
    } catch (caught) {
      setError(accountErrorMessage(caught, editing === null ? 'Could not add context' : 'Could not save context'))
    } finally {
      setAdding(false)
    }
  }

  const removeContext = async (name: string): Promise<void> => {
    setError(null)
    try {
      await onDelete(name)
    } catch (caught) {
      setError(accountErrorMessage(caught, 'Could not delete context'))
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
          setPropertyPicker(null)
        }
      }}
    >
      <Popover.Trigger
        className="ui-select-trigger task-property-control"
        aria-label={value === null ? ariaLabel : `${ariaLabel}: ${value}`}
        data-testid="context-select-trigger"
      >
        {selectedContext === null ? (
          <span className="ui-select-placeholder">{placeholder}</span>
        ) : (
          <ContextPill name={selectedContext.name} contexts={contexts} />
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="ui-popover-positioner" sideOffset={5} align="start" collisionPadding={12}>
          <Popover.Popup
            className="context-menu"
            aria-label={ariaLabel}
            initialFocus={searchRef}
            data-testid="context-select-menu"
          >
            {propertyPicker === null ? (
              <>
                <div className="context-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    value={query}
                    placeholder="Search contexts"
                    aria-label="Search contexts"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
                  />
                </div>
                <div className="context-options" role="listbox" aria-label="Contexts">
                  {matchingContexts.map((context) => (
                    <div key={context.name} className="context-option-row">
                      <button
                        type="button"
                        role="option"
                        aria-selected={context.name === value}
                        className={`context-option${context.name === value ? ' is-selected' : ''}`}
                        onClick={() => {
                          onChange(context.name)
                          setOpen(false)
                        }}
                      >
                        <ContextPill name={context.name} contexts={contexts} />
                        {context.name === value ? <Check size={14} aria-hidden="true" /> : null}
                      </button>
                      <button type="button" className="context-option-edit" aria-label={`Edit context ${context.name}`} onClick={() => beginEdit(context)}><Pencil size={13} /></button>
                      <button type="button" className="context-option-delete" aria-label={`Delete context ${context.name}`} onClick={() => void removeContext(context.name)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {matchingContexts.length === 0 ? <span className="context-picker-empty">No matching contexts</span> : null}
                </div>
              </>
            ) : null}

            <div className="context-add">
              <div className="context-composer-heading">
                <span>{editing === null ? 'Create context' : `Edit ${editing}`}</span>
                {editing !== null ? <button type="button" aria-label="Stop editing context" onClick={resetComposer}><X size={13} /></button> : null}
              </div>
              <div className="context-composer">
                <input
                  value={draft}
                  maxLength={48}
                  placeholder="Context name"
                  aria-label={editing === null ? 'New context' : `Context name for ${editing}`}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    event.stopPropagation()
                    void saveContext()
                  }}
                />
                <button type="button" className="context-property-trigger" aria-label={`Context icon: ${contextIconLabel(draftIcon)}`} aria-expanded={propertyPicker === 'icon'} onClick={() => setPropertyPicker(propertyPicker === 'icon' ? null : 'icon')}><ContextGlyph icon={draftIcon} size={14} /></button>
                <button type="button" className="context-property-trigger" aria-label={`Context color: ${draftColor}`} aria-expanded={propertyPicker === 'color'} onClick={() => setPropertyPicker(propertyPicker === 'color' ? null : 'color')}><span className={`context-color-swatch is-${draftColor}`} aria-hidden="true" /></button>
                <button type="button" className="context-create-button" disabled={draft.trim() === '' || adding} onClick={() => void saveContext()}>
                  {editing === null ? <Plus size={14} /> : <Check size={14} />}
                  {editing === null ? 'Add' : 'Save'}
                </button>
              </div>
            </div>

            {propertyPicker === 'icon' ? (
              <div className="context-inline-picker" data-testid="context-icon-picker">
                <div className="context-inline-heading"><button type="button" onClick={() => setPropertyPicker(null)}>Back</button><span>Choose icon</span></div>
                <div className="context-icon-catalog" role="radiogroup" aria-label="Context icons">
                  {CONTEXT_ICON_CATEGORIES.map((category) => (
                    <div key={category} className="context-icon-category">
                      <span>{category}</span>
                      <div className="context-icon-grid">
                        {CONTEXT_ICON_OPTIONS.filter((option) => option.category === category).map((option) => (
                          <button key={option.value} type="button" role="radio" aria-checked={draftIcon === option.value} aria-label={option.label} className={draftIcon === option.value ? 'is-selected' : ''} onKeyDown={(event) => moveGridFocus(event, '.context-icon-grid')} onClick={() => { setDraftIcon(option.value); setPropertyPicker(null) }}><ContextGlyph icon={option.value} size={15} /></button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {propertyPicker === 'color' ? (
              <div className="context-inline-picker" data-testid="context-color-picker">
                <div className="context-inline-heading"><button type="button" onClick={() => setPropertyPicker(null)}>Back</button><span>Choose color</span></div>
                <div className="context-color-picker" role="radiogroup" aria-label="Context color">
                  {CONTEXT_COLOR_OPTIONS.map((option) => (
                    <button key={option.value} type="button" role="radio" aria-checked={draftColor === option.value} className={draftColor === option.value ? 'is-selected' : ''} onKeyDown={(event) => moveGridFocus(event, '.context-color-picker')} onClick={() => { setDraftColor(option.value); setPropertyPicker(null) }}>
                      <span className={`context-color-swatch is-${option.value}`} aria-hidden="true" /><span>{option.label}</span>{draftColor === option.value ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {error !== null ? <span className="context-error" role="alert">{error}</span> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
