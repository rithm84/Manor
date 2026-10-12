import { describe, expect, it } from 'vitest'
import { sourceDateLabel } from './ProblemSourceDetails'

describe('Source date presentation', () => {
  it('preserves reported precision and handles time-zone offsets only for real instants', () => {
    expect(sourceDateLabel({ value: '2026', precision: 'year' })).toBe('2026')
    expect(sourceDateLabel({ value: '2026-03', precision: 'month' })).toBe('Mar 2026')
    expect(sourceDateLabel({ value: '2026-03-08', precision: 'day' })).toBe('Mar 8, 2026')
    expect(sourceDateLabel({ value: '2026-10-11T23:30:00-07:00', precision: 'instant' })).toBe('Oct 12, 2026, 6:30 AM UTC')
  })
})
