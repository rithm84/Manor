import { describe, expect, it } from 'vitest'

import {
  parseAddLeetCodeAttemptMutation,
  parseLeetCodeSeed,
  parseUpdateLeetCodeAttemptMutation
} from './leetcode'

const SOURCE = `class Solution:
    # keep this comment and indentation
    def twoSum(self, nums, target):
        return [0, 1]${'  '}

`

describe('LeetCode validation', () => {
  it('preserves pasted source, comments, trailing spaces, and blank lines exactly', () => {
    expect(
      parseAddLeetCodeAttemptMutation({
        problemId: 'two-sum',
        date: '2026-08-22',
        solution: SOURCE
      }).solution
    ).toBe(SOURCE)
    expect(
      parseUpdateLeetCodeAttemptMutation({
        attemptId: 'attempt-one',
        date: '2026-08-23',
        solution: SOURCE
      }).solution
    ).toBe(SOURCE)
  })

  it('rejects blank new solutions and invalid dates', () => {
    expect(() =>
      parseAddLeetCodeAttemptMutation({
        problemId: 'two-sum',
        date: '2026-08-22',
        solution: '   \n'
      })
    ).toThrow(/pasted solution source/)
    expect(() =>
      parseAddLeetCodeAttemptMutation({
        problemId: 'two-sum',
        date: '2026-02-30',
        solution: SOURCE
      })
    ).toThrow(/real calendar date/)
  })

  it('rejects seed attempts that reference a missing problem', () => {
    expect(() =>
      parseLeetCodeSeed({
        problems: [],
        attempts: [
          {
            id: 'attempt-one',
            problemId: 'missing',
            date: '2026-08-22',
            solution: '',
            createdAt: '2026-08-22T12:00:00.000Z',
            updatedAt: '2026-08-22T12:00:00.000Z'
          }
        ],
        summary: {
          totalProblems: 150,
          streak: 5,
          freezesLeft: 3,
          freezesPerMonth: 5,
          legacyProgress: []
        }
      })
    ).toThrow(/unknown problem/)
  })
})
