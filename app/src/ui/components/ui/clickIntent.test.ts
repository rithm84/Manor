import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent, MouseEvent } from 'react'

import { useClickIntent } from './clickIntent'

const RECT = { right: 200, top: 40, height: 80 }

function mouseEvent(clientX: number, clientY: number): MouseEvent<HTMLDivElement> {
  return {
    clientX,
    clientY,
    currentTarget: { getBoundingClientRect: () => RECT },
    preventDefault: vi.fn()
  } as unknown as MouseEvent<HTMLDivElement>
}

function keyEvent(key: string, shiftKey: boolean): KeyboardEvent<HTMLDivElement> {
  return {
    key,
    shiftKey,
    currentTarget: { getBoundingClientRect: () => RECT },
    preventDefault: vi.fn()
  } as unknown as KeyboardEvent<HTMLDivElement>
}

describe('click intent', () => {
  it('opens on the first primary click with no disambiguation delay', () => {
    const open = vi.fn()
    const actions = vi.fn()
    const handlers = useClickIntent(open, actions, false)

    handlers.onClick(mouseEvent(120, 60))

    expect(open).toHaveBeenCalledOnce()
    expect(actions).not.toHaveBeenCalled()
  })

  it('opens quick actions on right-click at the pointer position', () => {
    const open = vi.fn()
    const actions = vi.fn()
    const handlers = useClickIntent(open, actions, false)
    const event = mouseEvent(120, 60)

    handlers.onContextMenu(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(actions).toHaveBeenCalledWith({ x: 120, y: 60, source: 'pointer' })
    expect(open).not.toHaveBeenCalled()
  })

  it('opens quick actions from Shift+F10 and the context-menu key, anchored to the element', () => {
    const actions = vi.fn()
    const handlers = useClickIntent(vi.fn(), actions, false)

    handlers.onKeyDown(keyEvent('F10', true))
    handlers.onKeyDown(keyEvent('ContextMenu', false))

    expect(actions).toHaveBeenCalledTimes(2)
    expect(actions).toHaveBeenLastCalledWith({ x: 192, y: 72, source: 'keyboard' })
  })

  it('ignores every input while disabled', () => {
    const open = vi.fn()
    const actions = vi.fn()
    const handlers = useClickIntent(open, actions, true)

    handlers.onClick(mouseEvent(120, 60))
    handlers.onContextMenu(mouseEvent(120, 60))
    handlers.onKeyDown(keyEvent('F10', true))
    handlers.openNow()

    expect(open).not.toHaveBeenCalled()
    expect(actions).not.toHaveBeenCalled()
  })
})
