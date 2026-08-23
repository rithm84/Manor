import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { QuickActionPoint } from './clickIntent'

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
const MENU_ESTIMATED_HEIGHT = 128
const VIEWPORT_GUTTER = 12

function menuPosition(point: QuickActionPoint): CSSProperties {
  const left = Math.max(
    VIEWPORT_GUTTER,
    Math.min(point.x, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER)
  )
  const top = Math.max(
    VIEWPORT_GUTTER,
    Math.min(point.y, window.innerHeight - MENU_ESTIMATED_HEIGHT - VIEWPORT_GUTTER)
  )
  return { left, top, width: MENU_WIDTH }
}

export function QuickActionsMenu({ point, label, items, onClose }: QuickActionsMenuProps): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

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
      style={menuPosition(point)}
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
