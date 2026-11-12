import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { JobRole, JobStage, JobStageTransition } from '../../../shared/jobs'
import { JobsFlow } from './JobsFlow'
import { emptyJobRoleFields } from './jobsModel'

function roleAtStage(id: string, stage: JobStage): JobRole {
  return {
    ...emptyJobRoleFields(stage),
    id,
    company: 'Example Company',
    role: 'Software Engineer',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z'
  }
}

describe('JobsFlow', () => {
  it('counts applications separately from stage moves in the accessible summary', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-01T12:00:00.000Z' },
      { id: '2', roleId: 'b', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-02T12:00:00.000Z' },
      { id: '3', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-03T12:00:00.000Z' }
    ]
    const roles = [roleAtStage('a', 'oa'), roleAtStage('b', 'applied'), roleAtStage('c', 'to_apply')]
    const markup = renderToStaticMarkup(<JobsFlow roles={roles} transitions={transitions} />)
    expect(markup).toContain('class="jobs-flow-a11y"')
    expect(markup).toContain('2 applications')
    expect(markup).toContain('Applied to OA: 1 role')
    expect(markup).not.toContain('<table>')
    expect(markup).not.toContain('To apply')
  })

  it('shows the application count even before any role advances', () => {
    const markup = renderToStaticMarkup(<JobsFlow roles={[roleAtStage('a', 'applied')]} transitions={[]} />)
    expect(markup).toContain('No pipeline movement yet')
    expect(markup).toContain('1 application')
    expect(markup).not.toContain('<table>')
  })
})
