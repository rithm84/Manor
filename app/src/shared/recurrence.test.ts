import { describe, expect, it } from 'vitest'
import { parseRecurrence, serializeRecurrence } from './recurrence'

describe('task repeat dates', () => {
  it('retains the exact end year and selected weekdays through editing', () => {
    const input = { every: 2, unit: 'week' as const, weekdays: ['Mon', 'Fri'], until: '2028-01-06' }
    const saved = serializeRecurrence(input)
    expect(saved).toContain('UNTIL=20280106T235959Z')
    expect(parseRecurrence(saved)).toEqual(input)
  })
})
