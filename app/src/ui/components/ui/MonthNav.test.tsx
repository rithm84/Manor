// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { MonthNav } from './MonthNav'
import { ViewTabs } from './ViewTabs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function mount(node: React.ReactNode): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

describe('MonthNav', () => {
  it('steps with the arrow keys within its limits and offers the month name as a way back to this month', async () => {
    const shifts: number[] = []
    let returned = 0
    const { host, unmount } = await mount(
      <MonthNav label="History month" monthLabel="July 2026" canMoveBack canMoveForward={false} onShift={(direction) => shifts.push(direction)} onCurrent={() => { returned += 1 }} />
    )
    try {
      const group = host.querySelector<HTMLElement>('[role="group"]')
      if (group === null) throw new Error('Group unavailable')
      await act(async () => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
      await act(async () => { group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
      expect(shifts).toEqual([-1])
      const name = host.querySelector<HTMLButtonElement>('.ui-monthnav-label')
      expect(name?.tagName).toBe('BUTTON')
      await act(async () => name?.click())
      expect(returned).toBe(1)
    } finally {
      await unmount()
    }
  })

  it('shows the current month as plain text', async () => {
    const { host, unmount } = await mount(
      <MonthNav label="History month" monthLabel="September 2026" canMoveBack canMoveForward={false} onShift={() => undefined} />
    )
    try {
      expect(host.querySelector('.ui-monthnav-label')?.tagName).toBe('SPAN')
    } finally {
      await unmount()
    }
  })
})

describe('ViewTabs', () => {
  it('moves between tabs with the arrow keys and keeps one tab in the tab order', async () => {
    let value: 'daily' | 'history' = 'daily'
    const tabs = [{ value: 'daily' as const, label: 'Daily' }, { value: 'history' as const, label: 'History' }]
    const { host, unmount } = await mount(
      <ViewTabs label="Habits view" tabs={tabs} value={value} onChange={(next) => { value = next }} />
    )
    try {
      const [daily, history] = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      expect(daily?.tabIndex).toBe(0)
      expect(history?.tabIndex).toBe(-1)
      await act(async () => { daily?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
      expect(value).toBe('history')
      await act(async () => { daily?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })) })
      expect(value).toBe('history')
    } finally {
      await unmount()
    }
  })
})
