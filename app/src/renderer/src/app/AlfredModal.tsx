import type { ReactNode } from 'react'

import type { AlfredRoute } from '../../../shared/alfred'
import { Modal } from '../components/ui'
import { AlfredExperience } from '../alfred/AlfredExperience'

export interface AlfredModalProps {
  open: boolean
  onClose: () => void
  onNavigate: (route: AlfredRoute) => void
}

export function AlfredModal({ open, onClose, onNavigate }: AlfredModalProps): ReactNode {
  return (
    <Modal open={open} onClose={onClose} width={480} ariaLabel="Alfred">
      <AlfredExperience active={open} variant="modal" onEnd={onClose} onNavigate={onNavigate} />
    </Modal>
  )
}
