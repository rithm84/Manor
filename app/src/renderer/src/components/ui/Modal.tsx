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
  const modalRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

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
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    window.requestAnimationFrame(() => {
      const modal = modalRef.current
      if (modal === null || modal.contains(document.activeElement)) return
      modal.querySelector<HTMLElement>('[autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus()
    })

    const onKeyDown = (event: KeyboardEvent): void => {
      const visibleModals = document.querySelectorAll<HTMLElement>('.ui-modal')
      if (visibleModals.item(visibleModals.length - 1) !== modalRef.current) return
      if (event.key === 'Escape') {
        if (modalRef.current?.querySelector('[aria-expanded="true"]') !== null) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || modalRef.current === null) return
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!modalRef.current.contains(document.activeElement)) {
        event.preventDefault()
        const focusTarget = event.shiftKey ? last : first
        focusTarget.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open])

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
      <div ref={modalRef} className="ui-modal" style={{ width }} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  )
}
