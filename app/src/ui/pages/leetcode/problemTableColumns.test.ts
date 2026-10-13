import { describe, expect, it } from 'vitest'
import { fittingChipCount, fittingColumns } from './problemTableColumns'

describe('fittingColumns', () => {
  const chosen = ['difficulty', 'lastAsked', 'topics', 'companies', 'collections', 'status'] as const
  it('keeps every chosen column when the row fits, in the chosen order', () => {
    expect(fittingColumns(chosen, 1400)).toEqual(chosen)
  })
  it('drops collections, then last asked, then topics as the table narrows, keeping status and difficulty longest', () => {
    expect(fittingColumns(chosen, 1150)).toEqual(['difficulty', 'lastAsked', 'topics', 'companies', 'status'])
    expect(fittingColumns(chosen, 1000)).toEqual(['difficulty', 'topics', 'companies', 'status'])
    expect(fittingColumns(chosen, 820)).toEqual(['difficulty', 'companies', 'status'])
    expect(fittingColumns(chosen, 600)).toEqual(['difficulty', 'status'])
    expect(fittingColumns(chosen, 500)).toEqual(['status'])
  })
})

describe('fittingChipCount', () => {
  it('shows every chip that fits whole and leaves room for the counter otherwise', () => {
    expect(fittingChipCount([60, 50], 4, 24, 120)).toBe(2)
    expect(fittingChipCount([60, 50, 40], 4, 24, 120)).toBe(1)
    expect(fittingChipCount([60, 50, 40], 4, 24, 150)).toBe(2)
    expect(fittingChipCount([140, 30], 4, 24, 120)).toBe(0)
    expect(fittingChipCount([], 4, 24, 120)).toBe(0)
  })
})
