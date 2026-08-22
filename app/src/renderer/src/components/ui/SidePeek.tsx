import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface SidePeekProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Panel width in px (Notion side peek is ~420-480). */
  width: number
  /** Extra header controls rendered left of the close button. */
  headerActions?: ReactNode
}

const CLOSE_MS = 240

/** Notion-style side peek: right slide-in detail panel over a light scrim. */
export function SidePeek({ open, onClose, title, children, width, headerActions }: SidePeekProps): ReactNode {
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
    <div className={`ui-sidepeek-root${closing ? ' is-closing' : ''}`}>
      <div className="ui-sidepeek-scrim" onClick={onClose} />
      <aside className="ui-sidepeek" style={{ width }} role="dialog" aria-label={title}>
        <header className="ui-sidepeek-header">
          <span className="ui-sidepeek-title">{title}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {headerActions}
            <button
              type="button"
              className="ui-button ui-button--subtle"
              style={{ height: 28, padding: '0 6px' }}
              onClick={onClose}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </span>
        </header>
        <div className="ui-sidepeek-body">{children}</div>
      </aside>
    </div>
  )
}
