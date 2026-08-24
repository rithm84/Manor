import { Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { CalendarDefinition } from '../../../../shared/calendar'
import { Button, Modal } from '../../components/ui'

export const CALENDAR_COLORS = [
  '#3b684b', '#416883', '#6a4e6c', '#815e18', '#a33f46', '#32686c', '#6d6422', '#8a5b3f'
] as const

export interface CalendarEditorDialogProps {
  open: boolean
  calendar: CalendarDefinition | null
  onClose: () => void
  onSave: (name: string, color: string) => void
  onDelete: (() => void) | null
}

export function CalendarEditorDialog({
  open,
  calendar,
  onClose,
  onSave,
  onDelete
}: CalendarEditorDialogProps): ReactNode {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(CALENDAR_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(calendar?.name ?? '')
    setColor(calendar?.color ?? CALENDAR_COLORS[0])
    setConfirmDelete(false)
  }, [calendar, open])

  return (
    <Modal open={open} onClose={onClose} width={440} ariaLabel={calendar === null ? 'Create calendar' : 'Edit calendar'}>
      <form
        className="cal-compact-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() !== '') onSave(name.trim(), color)
        }}
      >
        <header className="cal-dialog-header">
          <div><span className="cal-dialog-eyebrow">Calendar</span><h2>{calendar === null ? 'New calendar' : calendar.name}</h2></div>
          <button type="button" className="cal-icon-btn" onClick={onClose} aria-label="Close calendar editor"><X size={16} /></button>
        </header>
        <div className="cal-dialog-body">
          <label className="cal-field cal-field--wide">
            <span>Name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
          </label>
          <fieldset className="cal-color-field">
            <legend>Color</legend>
            <div className="cal-color-options">
              {CALENDAR_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cal-color-option${color === option ? ' is-selected' : ''}`}
                  style={{ '--calendar-color': option } as React.CSSProperties}
                  aria-label={`Use ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </fieldset>
        </div>
        <footer className="cal-dialog-footer">
          {confirmDelete ? (
            <div className="cal-calendar-delete-confirm" role="alert">
              <span><strong>Delete this calendar?</strong><small>Its local events will also be deleted.</small></span>
              <span className="cal-dialog-actions"><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="is-danger" onClick={() => onDelete?.()}>Delete calendar</button></span>
            </div>
          ) : (
            <>
              {onDelete !== null ? <button type="button" className="cal-danger-button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</button> : <span />}
              <span className="cal-dialog-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><button type="submit" className="ui-button ui-button--primary" disabled={name.trim() === ''}>{calendar === null ? 'Create calendar' : 'Save'}</button></span>
            </>
          )}
        </footer>
      </form>
    </Modal>
  )
}
