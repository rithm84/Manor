import { describe, expect, it } from 'vitest'

import type { LeetCodeState } from '../../../shared/leetcode'
import { buildLeetCodeView, recentAttemptCounts } from './leetCodeModel'

const STATE: LeetCodeState = {
  problems: [
    {
      id: 'two-sum',
      topic: 'Arrays & Hashing',
      name: 'Two Sum',
      difficulty: 'Easy',
      curriculumOrder: 0
    },
    {
      id: 'valid-anagram',
      topic: 'Arrays & Hashing',
      name: 'Valid Anagram',
      difficulty: 'Easy',
      curriculumOrder: 1
    }
  ],
  attempts: [
    {
      id: 'attempt-one',
      problemId: 'two-sum',
      date: '2026-08-21',
      solution: 'first',
      createdAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-21T12:00:00.000Z'
    },
    {
      id: 'attempt-two',
      problemId: 'two-sum',
      date: '2026-08-22',
      solution: 'review',
      createdAt: '2026-08-22T12:00:00.000Z',
      updatedAt: '2026-08-22T12:00:00.000Z'
    }
  ],
  notes: [],
  summary: {
    totalProblems: 150,
    streak: 5,
    freezesLeft: 3,
    freezesPerMonth: 5,
    legacyProgress: [{ topic: 'Everything after', solvedCount: 3, attemptCount: 3 }]
  }
}

describe('LeetCode view model', () => {
  it('counts repeat reviews as attempts without duplicating the solved problem', () => {
    const view = buildLeetCodeView(STATE, [
      { name: 'Arrays & Hashing', done: 0, total: 9 },
      { name: 'Everything after', done: 3, total: 90 }
    ])

    expect(view.distinctSolved).toBe(4)
    expect(view.attemptCount).toBe(5)
    expect(view.topics[0]).toMatchObject({ done: 1, total: 9 })
    expect(view.topics[0]?.problems?.[0]).toMatchObject({ attemptCount: 2, lastAttemptDate: '2026-08-22' })
  })

  it('counts every solve and review in daily intensity', () => {
    expect(recentAttemptCounts(STATE.attempts, '2026-08-22', 2)).toEqual([
      { date: '2026-08-21', count: 1 },
      { date: '2026-08-22', count: 1 }
    ])
  })
})
