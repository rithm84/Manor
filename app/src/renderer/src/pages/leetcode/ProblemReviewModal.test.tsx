import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ProblemReviewModal } from './ProblemReviewModal'

const SOURCE = `class Solution:
    # exact comment
    def twoSum(self, nums, target):
        return [0, 1]
`

describe('ProblemReviewModal', () => {
  it('renders a centered accessible review workflow with exact solution history', () => {
    const markup = renderToStaticMarkup(
      <ProblemReviewModal
        problem={{
          id: 'two-sum',
          topic: 'Arrays & Hashing',
          name: 'Two Sum',
          difficulty: 'Easy',
          curriculumOrder: 0
        }}
        attempts={[
          {
            id: 'attempt-one',
            problemId: 'two-sum',
            date: '2026-08-22',
            solution: SOURCE,
            createdAt: '2026-08-22T12:00:00.000Z',
            updatedAt: '2026-08-22T12:00:00.000Z'
          }
        ]}
        today="2026-08-22"
        onClose={vi.fn()}
        onAddAttempt={vi.fn()}
        onUpdateAttempt={vi.fn()}
        onDeleteAttempt={vi.fn()}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="Two Sum solve and review history"')
    expect(markup).toContain('type="date"')
    expect(markup).toContain('<textarea')
    expect(markup).toContain('Attempt 1')
    expect(markup).toContain(SOURCE)
  })
})
