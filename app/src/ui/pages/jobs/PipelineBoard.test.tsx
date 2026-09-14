// @vitest-environment happy-dom
import { ViewTestServices } from '../../testing/viewServices'
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type { JobRole, JobStage } from '../../../shared/jobs'
import { PIPELINE_VISIBLE_CARDS, toBoardCard } from './jobsModel'
import { PipelineBoard } from './PipelineBoard'

function role(id: string, stage: JobStage): JobRole {
  return {
    id,
    company: 'Acme',
    role: 'Intern',
    location: '',
    postingLink: '',
    datePosted: '2026-08-14',
    stage,
    appliedDate: stage === 'to_apply' ? null : '2026-08-15',
    oaDueDate: null,
    interview1Date: null,
    interview2Date: null,
    interview3Date: null,
    decisionDate: null,
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z'
  }
}

const idle = {
  arrivedIds: new Set<string>(),
  onDropOnColumn: () => undefined,
  onOpenCard: () => undefined,
  onMoveCard: () => undefined,
  onRemoveCard: () => undefined
}

describe('PipelineBoard', () => {
  it('lets columns grow until any column reaches five cards, then caps them', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const four = Array.from({ length: PIPELINE_VISIBLE_CARDS - 1 }, (_, index) =>
      toBoardCard(role(`short-${index}`, 'to_apply'), '2026-08-20')
    )
    try {
      await act(async () => root.render(
        <ViewTestServices>
          <PipelineBoard cards={four} today="2026-08-20" {...idle} />
        </ViewTestServices>
      ))
      expect(document.querySelector('[data-testid="pipeline-board"]')?.classList.contains('is-capped')).toBe(false)

      const five = [
        ...four,
        toBoardCard(role('fifth', 'to_apply'), '2026-08-20'),
        toBoardCard(role('other', 'applied'), '2026-08-20')
      ]
      await act(async () => root.render(
        <ViewTestServices>
          <PipelineBoard cards={five} today="2026-08-20" {...idle} />
        </ViewTestServices>
      ))
      expect(document.querySelector('[data-testid="pipeline-board"]')?.classList.contains('is-capped')).toBe(true)
      expect(document.querySelector('[data-testid="pipeline-card-fifth"]')?.getAttribute('draggable')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
