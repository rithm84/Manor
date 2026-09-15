import { describe, expect, it } from 'vitest'

import type { MoodFocusState } from '../../../shared/moodFocus'
import {
  earliestEntryMonth,
  focusAverageLabel,
  focusDistribution,
  monthGrid,
  monthSummary,
  monthTrend,
  moodAverageLabel,
  moodDistribution,
  sixMonthTrend
} from './moodFocusModel'

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

  it('sizes the trend to the selected range', () => {
    expect(monthTrend(state, '2026-08', 3).map((point) => point.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(monthTrend(state, '2026-08', 12)).toHaveLength(12)
  })

  it('names the scale step nearest an average', () => {
    expect(moodAverageLabel(4.5)).toBe('Great')
    expect(moodAverageLabel(3.4)).toBe('Neutral')
    expect(moodAverageLabel(null)).toBeNull()
    expect(focusAverageLabel(1.2)).toBe('Locked Out')
    expect(focusAverageLabel(5)).toBe('Locked In')
  })

  it('lays the month out from Monday and marks today and future days', () => {
    const grid = monthGrid(state.entries, '2026-08', state.today)
    expect(grid.leadBlanks).toBe(5)
    expect(grid.cells).toHaveLength(31)
    expect(grid.cells[0]).toMatchObject({ date: '2026-08-01', day: 1, future: false, today: false })
    expect(grid.cells[0]?.entry?.focus).toBe('Resting')
    expect(grid.cells[19]).toMatchObject({ date: '2026-08-20', today: true, future: false, entry: null })
    expect(grid.cells[20]).toMatchObject({ date: '2026-08-21', future: true })
  })

  it('counts rated days per level, with rest days at the end of focus', () => {
    const august = state.entries.filter((entry) => entry.date.startsWith('2026-08'))
    const mood = moodDistribution(august)
    expect(mood.map((row) => row.level)).toEqual(['Great', 'Good', 'Neutral', 'Bad', 'Awful'])
    expect(mood.find((row) => row.level === 'Great')).toMatchObject({ count: 1, share: 0.5 })
    const focus = focusDistribution(august)
    expect(focus.at(-1)).toMatchObject({ level: 'Resting', count: 1, share: 0.5 })
    expect(moodDistribution([]).every((row) => row.count === 0 && row.share === 0)).toBe(true)
  })
})
