import { describe, expect, it } from 'vitest'

import type { MoodFocusState } from '../../../../shared/moodFocus'
import { earliestEntryMonth, monthSummary, sixMonthTrend } from './moodFocusModel'

const state: MoodFocusState = {
  today: '2026-08-20',
  entries: [
    {
      date: '2026-07-31',
      mood: 'Good',
      focus: 'High',
      note: null,
      noteSource: null,
      createdAt: '2026-07-31T21:00:00.000Z',
      updatedAt: '2026-07-31T21:00:00.000Z'
    },
    {
      date: '2026-08-01',
      mood: 'Great',
      focus: 'Resting',
      note: null,
      noteSource: null,
      createdAt: '2026-08-01T21:00:00.000Z',
      updatedAt: '2026-08-01T21:00:00.000Z'
    },
    {
      date: '2026-08-02',
      mood: 'Good',
      focus: 'High',
      note: null,
      noteSource: null,
      createdAt: '2026-08-02T21:00:00.000Z',
      updatedAt: '2026-08-02T21:00:00.000Z'
    }
  ]
}

describe('mood and focus history model', () => {
  it('keeps rest days out of the focus average', () => {
    const summary = monthSummary(state.entries, '2026-08')
    expect(summary).toMatchObject({ loggedDays: 2, moodAverage: 4.5, focusAverage: 4, restDays: 1 })
  })

  it('builds a six-month trend ending at the selected month', () => {
    const trend = sixMonthTrend(state, '2026-08')
    expect(trend).toHaveLength(6)
    expect(trend.at(-2)).toMatchObject({ month: '2026-07', mood: 4, focus: 4 })
    expect(trend.at(-1)).toMatchObject({ month: '2026-08', mood: 4.5, focus: 4 })
  })

  it('bounds backward navigation at the earliest entry month', () => {
    expect(earliestEntryMonth(state)).toBe('2026-07')
    expect(earliestEntryMonth({ today: state.today, entries: [] })).toBe('2026-08')
  })
})
