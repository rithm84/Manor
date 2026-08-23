import { useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

export const CLICK_INTENT_DELAY_MS = 180

export type ClickIntent = 'open-now' | 'queue-open' | 'open-actions' | 'ignore'

export function clickIntentForDetail(detail: number): ClickIntent {
  if (detail === 0) return 'open-now'
  if (detail === 1) return 'queue-open'
  if (detail === 2) return 'open-actions'
  return 'ignore'
}

export class ClickIntentController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly delayMs: number

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  handle(detail: number, onOpen: () => void, onActions: () => void): void {
    const intent = clickIntentForDetail(detail)
    if (intent === 'open-now') {
      this.cancel()
      onOpen()
      return
    }
    if (intent === 'queue-open') {
      this.cancel()
      this.timer = setTimeout(() => {
        this.timer = null
        onOpen()
      }, this.delayMs)
      return
    }
    if (intent === 'open-actions') {
      this.cancel()
      onActions()
    }
  }

  openNow(onOpen: () => void): void {
    this.cancel()
    onOpen()
  }

  actionsNow(onActions: () => void): void {
    this.cancel()
    onActions()
  }

  cancel(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

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

export function useClickIntent<T extends HTMLElement>(
  onOpen: () => void,
  onActions: (point: QuickActionPoint) => void,
  disabled: boolean
): ClickIntentHandlers<T> {
  const controllerRef = useRef<ClickIntentController | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = new ClickIntentController(CLICK_INTENT_DELAY_MS)
  }
  const controller = controllerRef.current

  useEffect(() => (): void => controller.cancel(), [controller])

  return {
    onClick: (event): void => {
      if (disabled) return
      const point = actionPointFor(event.currentTarget, event.clientX, event.clientY)
      controller.handle(event.detail, onOpen, () => onActions(point))
    },
    onContextMenu: (event): void => {
      if (disabled) return
      event.preventDefault()
      const point = actionPointFor(event.currentTarget, event.clientX, event.clientY)
      controller.actionsNow(() => onActions(point))
    },
    onKeyDown: (event): void => {
      if (disabled) return
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault()
        const point = actionPointFor(event.currentTarget, 0, 0)
        controller.actionsNow(() => onActions(point))
      }
    },
    openNow: (): void => {
      if (!disabled) controller.openNow(onOpen)
    }
  }
}
