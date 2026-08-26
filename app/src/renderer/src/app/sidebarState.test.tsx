// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { useSidebarDocked } from './sidebarState'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let writerSet: ((docked: boolean) => void) | null = null

/** Stands in for the frame toggle: only reads. */
function Reader(): ReactNode {
  const [docked] = useSidebarDocked()
  return <span id="reader">{docked ? 'docked' : 'collapsed'}</span>
}

/** Stands in for Settings: only writes. */
function Writer(): ReactNode {
  const [, setDocked] = useSidebarDocked()
  writerSet = setDocked
  return null
}

describe('sidebar docked preference', () => {
  beforeEach(() => {
    window.localStorage.clear()
    writerSet = null
  })

  it('live-syncs every subscriber and persists the choice', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <>
          <Reader />
          <Writer />
        </>
      )
    })
    expect(container.textContent).toBe('docked')

    act(() => {
      writerSet?.(false)
    })
    expect(container.textContent).toBe('collapsed')
    expect(window.localStorage.getItem('manor.sidebar.docked')).toBe('0')

    act(() => {
      writerSet?.(true)
    })
    expect(container.textContent).toBe('docked')
    expect(window.localStorage.getItem('manor.sidebar.docked')).toBe('1')

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
