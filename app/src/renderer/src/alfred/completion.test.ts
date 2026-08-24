import { describe, expect, it } from 'vitest'

import { buildAlfredCompletionGlance } from './completion'

describe('buildAlfredCompletionGlance', () => {
  it('uses persisted module state and has no Journal destination', () => {
    const date = '2026-08-20'
    const glance = buildAlfredCompletionGlance({
      home: {
        tasks: [
          { id: '1', title: 'Done', context: 'Uni', estimateMinutes: 30, priority: null, status: 'Done', due: date, tags: [], recurrence: null },
          { id: '2', title: 'Open', context: 'Uni', estimateMinutes: 30, priority: null, status: 'Not started', due: date, tags: [], recurrence: null }
        ],
        contexts: [],
        scratchBlocks: [],
        savedTaskViews: []
      },
      habits: {
        today: date,
        habits: [{ id: 'habit', name: 'Habit', kind: 'binary', targetLabel: null, createdOn: date, createdAt: `${date}T08:00:00Z` }],
        lifecycle: [{ habitId: 'habit', date, status: 'active', createdAt: `${date}T08:00:00Z` }],
        entries: [{ habitId: 'habit', date, value: 100, createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z` }],
        freezes: [],
        grants: [],
        pools: []
      },
      moodFocus: {
        today: date,
        entries: [{ date, mood: 'Good', focus: null, note: null, noteSource: null, createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` }]
      },
      leetcode: {
        problems: [],
        attempts: [],
        summary: { totalProblems: 150, streak: 0, freezesLeft: 0, freezesPerMonth: 0, legacyProgress: [] }
      }
    })

    expect(glance.items.map((item) => item.route)).toEqual([
      '/home',
      '/habits',
      '/mood-focus',
      '/leetcode'
    ])
    expect(glance.items.some((item) => item.route === ('/journal' as never))).toBe(false)
    expect(glance).toMatchObject({ done: 3, total: 6 })
  })
})
