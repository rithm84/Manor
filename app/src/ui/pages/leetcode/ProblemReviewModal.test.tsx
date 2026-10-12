// @vitest-environment happy-dom
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { describe, expect, it, vi } from 'vitest'

import { ProblemReviewModal } from './ProblemReviewModal'

const SOURCE = `class Solution:
    # exact comment
    def twoSum(self, nums, target):
        return [0, 1]
`

describe('ProblemReviewModal', () => {
  it('renders a centered accessible review workflow with exact solution history', async () => {
    const markup = await renderPortalMarkup(
      <ProblemReviewModal
        problem={{
          id: 'two-sum',
          topics: ['Arrays & Hashing'],
          companies: [], tags: [], collections: [], sourceUrl: null,
          name: 'Two Sum',
          difficulty: 'Easy',
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
    // History leads; logging a solve made elsewhere stays one click away.
    expect(markup).toContain('data-testid="lc-log-solve"')
    expect(markup).not.toContain('type="date"')
    expect(markup.indexOf('Attempt 1')).toBeLessThan(markup.indexOf('lc-log-solve'))
    expect(markup).toContain(SOURCE)
  })
})
