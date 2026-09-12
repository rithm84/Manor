import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Native modal keeps focus inside the isolated Journal surface. */
export function Modal({ children, labelledBy, busy, onClose }: { children: ReactNode; labelledBy: string; busy: boolean; onClose: () => void }): ReactNode {
  const element = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = element.current
    if (dialog === null) throw new Error('Journal dialog is unavailable')
    dialog.showModal()
    return (): void => dialog.close()
  }, [])
  return <dialog ref={element} className="journal-modal" aria-labelledby={labelledBy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>{children}</dialog>
}
