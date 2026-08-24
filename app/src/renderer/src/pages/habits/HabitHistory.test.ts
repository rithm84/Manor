import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  HabitPerformanceDonut,
  habitDonutPresentation,
  habitPerformanceLabel,
  habitPerformanceSlices
} from './HabitHistory'
import type { HabitMonthRow } from './habitModel'

const PERFORMANCE_ROW: HabitMonthRow = {
  habit: {
    id: 'read',
    name: 'Read',
    kind: 'binary',
    targetLabel: null,
    createdOn: '2026-08-01',
    createdAt: '2026-08-01T08:00:00.000Z'
  },
  status: 'retired',
  days: ['complete', 'complete', 'partial', 'frozen', 'missed', 'pending', 'future'],
  completedDays: 2,
  partialDays: 1,
  frozenDays: 1,
  trackedDays: 6,
  completionRate: 33
}

const FULL_ROW: HabitMonthRow = {
  ...PERFORMANCE_ROW,
  status: 'active',
  days: ['complete', 'complete', 'complete'],
  completedDays: 3,
  partialDays: 0,
  frozenDays: 0,
  trackedDays: 3,
  completionRate: 100
}

const ZERO_MIXED_ROW: HabitMonthRow = {
  ...PERFORMANCE_ROW,
  status: 'active',
  days: ['missed', 'pending'],
  completedDays: 0,
  partialDays: 0,
  frozenDays: 0,
  trackedDays: 2,
  completionRate: 0
}

describe('habit performance donut data', () => {
  it('preserves every tracked state as a purposeful chart slice', () => {
    expect(habitPerformanceSlices(PERFORMANCE_ROW)).toEqual([
      { key: 'complete', label: 'Complete', value: 2, fill: 'var(--completion)' },
      { key: 'partial', label: 'Partial', value: 1, fill: 'var(--primary)' },
      { key: 'frozen', label: 'Frozen', value: 1, fill: 'var(--frozen-info)' },
      { key: 'missed', label: 'Missed', value: 1, fill: 'var(--overdue-error)' },
      { key: 'pending', label: 'Pending', value: 1, fill: 'var(--surface-strong)' }
    ])
  })

  it('announces status, rate, counts, and drill-in intent', () => {
    expect(habitPerformanceLabel(PERFORMANCE_ROW)).toBe(
      'Read. Retired. 33% complete. 2 complete, 1 partial, 1 frozen, 1 missed, 1 pending. Open details.'
    )
  })

  it('renders exact 100% as a closed SVG circle without a Recharts sector seam', () => {
    const markup = renderToStaticMarkup(createElement(HabitPerformanceDonut, { row: FULL_ROW }))

    expect(habitDonutPresentation(FULL_ROW)).toMatchObject({
      seamlessFill: 'var(--completion)'
    })
    expect(markup).toContain('habit-history-seamless-ring')
    expect(markup).toContain('stroke="var(--completion)"')
    expect(markup).toContain('stroke-width="8"')
    expect(markup).toContain('100%')
    expect(markup).not.toContain('recharts-sector')
  })

  it('keeps zero-percent mixed composition separated and its center label at zero', () => {
    const markup = renderToStaticMarkup(
      createElement(HabitPerformanceDonut, { row: ZERO_MIXED_ROW })
    )

    expect(habitDonutPresentation(ZERO_MIXED_ROW).seamlessFill).toBeNull()
    expect(markup).toContain('0%')
    expect(markup).not.toContain('habit-history-seamless-ring')
  })
})
