import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { JobStageTransition } from '../../../shared/jobs'
import { JobsFlow } from './JobsFlow'

describe('JobsFlow', () => {
  it('starts at Applied and provides a hidden semantic summary without a visible table', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-01T12:00:00.000Z' },
      { id: '2', roleId: 'b', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-02T12:00:00.000Z' },
      { id: '3', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-03T12:00:00.000Z' }
    ]
    const markup = renderToStaticMarkup(<JobsFlow transitions={transitions} />)
    expect(markup).toContain('class="jobs-flow-a11y"')
    expect(markup).toContain('Applied to OA: 1 role')
    expect(markup).not.toContain('<table>')
    expect(markup).not.toContain('To apply')
  })

  it('renders a useful empty state without fabricated counts', () => {
    const markup = renderToStaticMarkup(<JobsFlow transitions={[]} />)
    expect(markup).toContain('No pipeline movement yet')
    expect(markup).not.toContain('<table>')
  })
})
