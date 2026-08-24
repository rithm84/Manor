import { CalendarRange, Repeat2, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Modal } from '../../components/ui'
import type { EventEditScope } from './EventDialog'

export interface RecurringChangeDialogProps {
  open: boolean
  title: string
  action: 'move' | 'resize'
  onClose: () => void
  onApply: (scope: EventEditScope) => void
}

export function RecurringChangeDialog({ open, title, action, onClose, onApply }: RecurringChangeDialogProps): ReactNode {
  return (
    <Modal open={open} onClose={onClose} width={460} ariaLabel={`${action === 'move' ? 'Move' : 'Resize'} recurring event`}>
      <section className="cal-compact-dialog">
        <header className="cal-dialog-header">
          <div><span className="cal-dialog-eyebrow">Recurring event</span><h2>{title}</h2></div>
          <button type="button" className="cal-icon-btn" onClick={onClose} aria-label="Cancel recurring event change"><X size={16} /></button>
        </header>
        <div className="cal-dialog-body cal-scope-options">
          <button type="button" autoFocus onClick={() => onApply('occurrence')}>
            <CalendarRange size={18} />
            <span><strong>This event</strong><small>{action === 'move' ? 'Move only this occurrence' : 'Resize only this occurrence'}</small></span>
          </button>
          <button type="button" onClick={() => onApply('series')}>
            <Repeat2 size={18} />
            <span><strong>All events</strong><small>{action === 'move' ? 'Shift the full series' : 'Change the series duration'}</small></span>
          </button>
        </div>
      </section>
    </Modal>
  )
}
