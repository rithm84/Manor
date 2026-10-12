import { describe, expect, it } from 'vitest'
import type { LeetCodeAttempt } from '../../../shared/leetcode'
import { attemptsForProblem } from './leetCodeModel'

const attempts: readonly LeetCodeAttempt[] = [
  { id: 'first', problemId: 'a', date: '2026-08-21', solution: 'original', createdAt: '2026-08-21T12:00:00Z', updatedAt: '2026-08-21T12:00:00Z' },
  { id: 'other', problemId: 'b', date: '2026-08-22', solution: 'other', createdAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-22T12:00:00Z' },
  { id: 'review', problemId: 'a', date: '2026-08-22', solution: 'review', createdAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-22T12:00:00Z' }
]

describe('problem attempt history', () => {
  it('preserves each exact solution and sorts reviews newest first without changing the source', () => {
    expect(attemptsForProblem(attempts, 'a').map(attempt => [attempt.id, attempt.solution])).toEqual([['review', 'review'], ['first', 'original']])
    expect(attempts.map(attempt => attempt.id)).toEqual(['first', 'other', 'review'])
  })
})
