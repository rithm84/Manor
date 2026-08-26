import type { KeyboardEvent, MouseEvent } from 'react'

export interface QuickActionPoint {
  x: number
  y: number
  source: 'pointer' | 'keyboard'
}

export interface ClickIntentHandlers<T extends HTMLElement> {
  onClick: (event: MouseEvent<T>) => void
  onContextMenu: (event: MouseEvent<T>) => void
  onKeyDown: (event: KeyboardEvent<T>) => void
  openNow: () => void
}

function actionPointFor(element: HTMLElement, clientX: number, clientY: number): QuickActionPoint {
  if (clientX !== 0 || clientY !== 0) return { x: clientX, y: clientY, source: 'pointer' }
  const rect = element.getBoundingClientRect()
  return {
    x: rect.right - 8,
    y: rect.top + Math.min(32, rect.height / 2),
    source: 'keyboard'
  }
}

/**
 * Click handling for task cards and rows: a primary click opens details
 * immediately; right-click (or the context-menu key / Shift+F10) opens the
 * quick-actions menu.
 */
export function useClickIntent<T extends HTMLElement>(
  onOpen: () => void,
  onActions: (point: QuickActionPoint) => void,
  disabled: boolean
): ClickIntentHandlers<T> {
  return {
    onClick: (): void => {
      if (disabled) return
      onOpen()
    },
    onContextMenu: (event): void => {
      if (disabled) return
      event.preventDefault()
      onActions(actionPointFor(event.currentTarget, event.clientX, event.clientY))
    },
    onKeyDown: (event): void => {
      if (disabled) return
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault()
        onActions(actionPointFor(event.currentTarget, 0, 0))
      }
    },
    openNow: (): void => {
      if (!disabled) onOpen()
    }
  }
}
