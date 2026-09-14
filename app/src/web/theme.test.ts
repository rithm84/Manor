import { describe, expect, it } from 'vitest'

import { darkFor, millisecondsToNextBoundary } from './theme'

const at = (hour: number, minute = 0): Date => new Date(2026, 8, 13, hour, minute)

describe('temporal theme', () => {
  it('is light from 6 AM until 6 PM and dark otherwise, regardless of the system preference', () => {
    expect(darkFor('temporal', at(5, 59), false)).toBe(true)
    expect(darkFor('temporal', at(6), true)).toBe(false)
    expect(darkFor('temporal', at(17, 59), true)).toBe(false)
    expect(darkFor('temporal', at(18), false)).toBe(true)
    expect(darkFor('system', at(12), true)).toBe(true)
    expect(darkFor('light', at(23), true)).toBe(false)
  })

  it('schedules the next switch at the coming boundary', () => {
    expect(millisecondsToNextBoundary(at(5, 30))).toBe(30 * 60_000)
    expect(millisecondsToNextBoundary(at(12))).toBe(6 * 3_600_000)
    expect(millisecondsToNextBoundary(at(22))).toBe(8 * 3_600_000)
  })
})
