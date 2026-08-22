import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Panel width in px. */
  width: number
  ariaLabel: string
}

const CLOSE_MS = 150

/**
 * Centered modal over a scrim. Esc and scrim-click dismiss. Enter animates
 * via @starting-style; exit plays a short closing transition before unmount.
 */
export function Modal({ open, onClose, children, width, ariaLabel }: ModalProps): ReactNode {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      setMounted(true)
      setClosing(false)
      return
    }
    if (mounted) {
      setClosing(true)
      closeTimer.current = window.setTimeout(() => {
        setMounted(false)
        setClosing(false)
        closeTimer.current = null
      }, CLOSE_MS)
    }
    return (): void => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
  }, [open, mounted])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!mounted) {
    return null
  }

  return (
    <div
      className={`ui-overlay${closing ? ' is-closing' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="ui-modal" style={{ width }} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  )
}
