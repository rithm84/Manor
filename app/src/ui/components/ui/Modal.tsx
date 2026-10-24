import { usePortalContainer } from './PortalContainer'
import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import { useRef } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  width: number
  ariaLabel: string
}

/** Shared portal and focus boundary; nested Base UI controls dismiss before their dialog. */
export function Modal({ open, onClose, children, width, ariaLabel }: ModalProps): ReactNode {
  const portalContainer = usePortalContainer()
  const panel = useRef<HTMLDivElement>(null)
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <Dialog.Portal container={portalContainer}>
      <Dialog.Backdrop className="ui-overlay" />
      <Dialog.Viewport className="ui-dialog-viewport">
        <Dialog.Popup ref={panel} className="ui-modal" style={{ width }} aria-label={ariaLabel} aria-modal="true"
          initialFocus={() => panel.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus], input:not([type="hidden"]), textarea') ?? true}>
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
}
