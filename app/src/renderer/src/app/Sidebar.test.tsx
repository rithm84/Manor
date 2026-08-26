// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Root } from 'react-dom/client'

import { Sidebar } from './Sidebar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function mountSidebar(): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <Sidebar mode="docked" />
      </MemoryRouter>
    )
  })
  return container
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

function openAccountMenu(host: HTMLElement): {
  trigger: HTMLButtonElement
  menu: HTMLElement
  items: readonly HTMLElement[]
} {
  const trigger = host.querySelector<HTMLButtonElement>('.sidebar-account')
  if (trigger === null) throw new Error('account trigger not rendered')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  const menu = host.querySelector<HTMLElement>('[role="menu"]')
  if (menu === null) throw new Error('account menu did not open')
  return {
    trigger,
    menu,
    items: Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
  }
}

describe('Sidebar account menu', () => {
  it('renders the open menu after the trigger and focuses the first item', () => {
    const host = mountSidebar()
    const { trigger, menu, items } = openAccountMenu(host)

    expect(trigger.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(items.length).toBe(2)
    expect(document.activeElement).toBe(items[0])
  })

  it('cycles items with arrow keys', () => {
    const host = mountSidebar()
    const { items } = openAccountMenu(host)

    act(() => {
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[1])

    act(() => {
      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[0])

    act(() => {
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[1])
  })

  it('closes on Escape and returns focus to the trigger', () => {
    const host = mountSidebar()
    const { trigger } = openAccountMenu(host)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
