import { afterEach, describe, expect, it } from 'vitest'

import type { LeetCodeSeed } from '../shared/leetcode'
import { LeetCodeStore } from './leetCodeStore'

const SOURCE_ONE = `class Solution:
    # first approach
    def twoSum(self, nums, target):
        return [0, 1]${'  '}
`
const SOURCE_TWO = `function twoSum(nums, target) {
  // reviewed with a map
  return [0, 1]
}
`

const SEED: LeetCodeSeed = {
  problems: [
    {
      id: 'two-sum',
      topic: 'Arrays & Hashing',
      name: 'Two Sum',
      difficulty: 'Easy',
      curriculumOrder: 0
    }
  ],
  attempts: [],
  summary: {
    totalProblems: 150,
    streak: 5,
    freezesLeft: 3,
    freezesPerMonth: 5,
    legacyProgress: []
  }
}

let store: LeetCodeStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

describe('LeetCodeStore', () => {
  it('appends multiple durable attempts without overwriting the problem or earlier source', () => {
    store = new LeetCodeStore(':memory:')
    store.load(SEED, '2026-08-22')

    const first = store.addAttempt(
      { problemId: 'two-sum', date: '2026-08-21', solution: SOURCE_ONE },
      '2026-08-21T20:00:00.000Z'
    )
    const second = store.addAttempt(
      { problemId: 'two-sum', date: '2026-08-22', solution: SOURCE_TWO },
      '2026-08-22T20:00:00.000Z'
    )

    expect(first.attempts).toHaveLength(1)
    expect(second.problems).toEqual(SEED.problems)
    expect(second.attempts).toHaveLength(2)
    expect(second.attempts.map((attempt) => attempt.solution)).toEqual([SOURCE_TWO, SOURCE_ONE])
  })

  it('edits and deletes only the selected attempt', () => {
    store = new LeetCodeStore(':memory:')
    store.load(SEED, '2026-08-22')
    const withFirst = store.addAttempt(
      { problemId: 'two-sum', date: '2026-08-21', solution: SOURCE_ONE },
      '2026-08-21T20:00:00.000Z'
    )
    const firstId = withFirst.attempts[0]?.id
    if (firstId === undefined) throw new Error('Expected the first attempt to be persisted')
    const withSecond = store.addAttempt(
      { problemId: 'two-sum', date: '2026-08-22', solution: SOURCE_TWO },
      '2026-08-22T20:00:00.000Z'
    )
    const secondId = withSecond.attempts.find((attempt) => attempt.id !== firstId)?.id
    if (secondId === undefined) throw new Error('Expected the second attempt to be persisted')

    const updated = store.updateAttempt(
      { attemptId: firstId, date: '2026-08-21', solution: `${SOURCE_ONE}\n# revised\n` },
      '2026-08-22T21:00:00.000Z'
    )
    expect(updated.attempts.find((attempt) => attempt.id === secondId)?.solution).toBe(SOURCE_TWO)

    const remaining = store.deleteAttempt(firstId)
    expect(remaining.attempts).toHaveLength(1)
    expect(remaining.attempts[0]?.id).toBe(secondId)
  })

  it('seeds once and never replaces persisted attempts on a later load', () => {
    store = new LeetCodeStore(':memory:')
    store.load(SEED, '2026-08-22')
    store.addAttempt(
      { problemId: 'two-sum', date: '2026-08-22', solution: SOURCE_ONE },
      '2026-08-22T20:00:00.000Z'
    )

    const reloaded = store.load({ ...SEED, attempts: [] }, '2026-08-22')
    expect(reloaded.attempts).toHaveLength(1)
    expect(reloaded.attempts[0]?.solution).toBe(SOURCE_ONE)
  })

  it('limits new attempt backfill to today or yesterday', () => {
    store = new LeetCodeStore(':memory:')
    store.load(SEED, '2026-08-22')

    expect(() =>
      store?.addAttempt(
        { problemId: 'two-sum', date: '2026-08-20', solution: SOURCE_ONE },
        '2026-08-22T20:00:00.000Z'
      )
    ).toThrow(/only be logged/)
  })
})
