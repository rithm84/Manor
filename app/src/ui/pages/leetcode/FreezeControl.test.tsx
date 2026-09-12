// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { FreezeControl } from './FreezeControl'
import type { LeetCodeFreezeMutation } from '../../../shared/leetcode'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('LeetCode freeze controls', () => {
  it('submits the server date and captured revision, prevents duplicates, and preserves a failed action', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const mutations: LeetCodeFreezeMutation[] = []
    let rejectSave: (error: Error) => void = () => { throw new Error('Save has not started') }
    await act(async () => {
      root.render(<FreezeControl action={{ date: '2026-08-31', applied: true, canApply: false, canClear: true, revision: 7 }} logged={false}
        onApply={async () => { throw new Error('Apply must not run for an applied freeze') }}
        onClear={(mutation) => { mutations.push(mutation); return new Promise<void>((_resolve, reject) => { rejectSave = reject }) }} />)
    })
    const button = container.querySelector<HTMLButtonElement>('[data-testid="leetcode-freeze-toggle"]')!
    await act(async () => button.click())
    expect(mutations).toEqual([{ date: '2026-08-31', expectedRevision: 7 }])
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(mutations).toHaveLength(1)
    await act(async () => rejectSave(new Error('This freeze changed elsewhere. Reload before retrying.')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('changed elsewhere')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.disabled).toBe(false)
    await act(async () => root.unmount())
  })

  it('does not offer a spend for a logged day after the refund reload', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const unexpected = async (): Promise<void> => { throw new Error('A logged day cannot spend a freeze') }
    await act(async () => root.render(<FreezeControl action={{ date: '2026-09-08', applied: false, canApply: false, canClear: false, revision: 2 }} logged onApply={unexpected} onClear={unexpected} />))
    expect(container.querySelector('[data-testid="leetcode-freeze-toggle"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
