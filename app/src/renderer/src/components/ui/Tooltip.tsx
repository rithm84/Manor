import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface TooltipProps {
  label: string
  children: ReactNode
  side: 'top' | 'bottom'
}

const SHOW_DELAY_MS = 400
/** After one tooltip closes, adjacent tooltips open instantly for this long. */
const INSTANT_WINDOW_MS = 500

let lastShownAt = 0

/**
 * Hover tooltip. Delays before the first show; once one tooltip has been
 * open, adjacent tooltips skip the delay (the toolbar-speed trick).
 */
export function Tooltip({ label, children, side }: TooltipProps): ReactNode {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return (): void => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    }
  }, [])

  const show = (): void => {
    const instant = Date.now() - lastShownAt < INSTANT_WINDOW_MS
    if (instant) {
      setVisible(true)
      return
    }
    timer.current = window.setTimeout(() => {
      setVisible(true)
    }, SHOW_DELAY_MS)
  }

  const hide = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (visible) {
      lastShownAt = Date.now()
    }
    setVisible(false)
  }

  return (
    <span className="ui-tooltip-anchor" onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>
      {children}
      {visible ? (
        <span className={`ui-tooltip${side === 'bottom' ? ' ui-tooltip--below' : ''}`} role="tooltip">
          {label}
        </span>
      ) : null}
    </span>
  )
}
