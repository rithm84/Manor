import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Modal } from './Modal'

export interface DetailDialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  width: number
  ariaLabel: string
}

/** Shared centered frame for object details with a fixed header and scrolling body. */
export function DetailDialog({
  open,
  onClose,
  title,
  children,
  width,
  ariaLabel
}: DetailDialogProps): ReactNode {
  return (
    <Modal open={open} onClose={onClose} width={width} ariaLabel={ariaLabel}>
      <section className="ui-detail-dialog">
        <header className="ui-detail-dialog-header">
          <h2 className="ui-detail-dialog-title">{title}</h2>
          <button
            type="button"
            className="ui-detail-dialog-close"
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={16} />
          </button>
        </header>
        <div className="ui-detail-dialog-body">{children}</div>
      </section>
    </Modal>
  )
}
