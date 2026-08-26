import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { QuickActionPoint } from './clickIntent'
import { useDismissLayer } from './dismissLayer'

export interface QuickActionItem {
  id: string
  label: string
  icon: ReactNode
  tone: 'default' | 'danger'
  onSelect: () => void
}

export interface QuickActionsMenuProps {
  point: QuickActionPoint
  label: string
  items: readonly QuickActionItem[]
  onClose: () => void
}

const MENU_WIDTH = 204
/** First-pass guess; a layout effect re-clamps with the measured height. */
const MENU_ESTIMATED_HEIGHT = 152
const VIEWPORT_GUTTER = 12

function menuPosition(point: QuickActionPoint, menuHeight: number): CSSProperties {
  const left = Math.max(
    VIEWPORT_GUTTER,
    Math.min(point.x, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER)
  )
  const top = Math.max(
    VIEWPORT_GUTTER,
    Math.min(point.y, window.innerHeight - menuHeight - VIEWPORT_GUTTER)
  )
  return { left, top, width: MENU_WIDTH }
}

export function QuickActionsMenu({ point, label, items, onClose }: QuickActionsMenuProps): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [style, setStyle] = useState<CSSProperties>(() => menuPosition(point, MENU_ESTIMATED_HEIGHT))

  useDismissLayer(true, onClose)

  useLayoutEffect(() => {
    const menu = rootRef.current
    if (menu !== null) setStyle(menuPosition(point, menu.offsetHeight))
  }, [point])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        onCloseRef.current()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [])

  const moveFocus = (direction: 1 | -1): void => {
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    )
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = current < 0 ? 0 : (current + direction + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={`ui-quick-actions${point.source === 'keyboard' ? ' is-keyboard' : ''}`}
      style={style}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveFocus(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveFocus(-1)
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`ui-quick-action${item.tone === 'danger' ? ' is-danger' : ''}`}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
