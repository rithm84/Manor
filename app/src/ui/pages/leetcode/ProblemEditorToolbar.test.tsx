// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeDraftStatus } from '../../../web/problems/ProblemDraftSession'
import { SaveState } from './ProblemEditorToolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SaveState', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stays quiet for fast saves, shows slow ones, and keeps a failure until it is resolved', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const resolve = vi.fn()
    const render = async (status: CodeDraftStatus, conflict: boolean): Promise<void> => { await act(async () => root.render(<SaveState status={status} conflict={conflict} onResolve={resolve} />)) }
    const state = (): string | null => host.querySelector('[data-testid="problem-draft-state"]')?.getAttribute('data-state') ?? null
    const advance = async (ms: number): Promise<void> => { await act(async () => { vi.advanceTimersByTime(ms) }) }
    try {
      await render('saved', false)
      expect(state()).toBe('idle')
      await render('protecting', false); await render('protected', false); await render('saving', false)
      await advance(200)
      await render('saved', false)
      expect(state()).toBe('idle')
      await render('saving', false)
      await advance(350)
      expect(state()).toBe('saving')
      expect(host.textContent).toContain('Saving…')
      await render('saved', false)
      expect(state()).toBe('justSaved')
      await advance(1600)
      expect(state()).toBe('idle')
      await render('protected', false)
      await advance(2100)
      expect(state()).toBe('queued')
      await render('failed', false)
      await advance(5000)
      expect(state()).toBe('attention')
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="problem-save-resolve"]')?.click())
      expect(resolve).toHaveBeenCalledOnce()
      await render('protected', true)
      expect(host.textContent).toContain('Compare')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
