import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLICK_INTENT_DELAY_MS, ClickIntentController, clickIntentForDetail } from './clickIntent'

afterEach(() => {
  vi.useRealTimers()
})

describe('click intent disambiguation', () => {
  it('keeps keyboard clicks immediate and reserves the second pointer click for actions', () => {
    expect(clickIntentForDetail(0)).toBe('open-now')
    expect(clickIntentForDetail(1)).toBe('queue-open')
    expect(clickIntentForDetail(2)).toBe('open-actions')
  })

  it('cancels the pending single-click open when a double-click arrives', () => {
    vi.useFakeTimers()
    const controller = new ClickIntentController(CLICK_INTENT_DELAY_MS)
    const open = vi.fn()
    const actions = vi.fn()

    controller.handle(1, open, actions)
    vi.advanceTimersByTime(80)
    controller.handle(2, open, actions)
    vi.advanceTimersByTime(CLICK_INTENT_DELAY_MS)

    expect(open).not.toHaveBeenCalled()
    expect(actions).toHaveBeenCalledOnce()
  })

  it('opens once after the short pointer disambiguation window', () => {
    vi.useFakeTimers()
    const controller = new ClickIntentController(CLICK_INTENT_DELAY_MS)
    const open = vi.fn()

    controller.handle(1, open, vi.fn())
    vi.advanceTimersByTime(CLICK_INTENT_DELAY_MS - 1)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(open).toHaveBeenCalledOnce()
  })
})
