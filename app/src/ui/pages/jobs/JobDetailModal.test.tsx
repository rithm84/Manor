// @vitest-environment happy-dom
import { ViewTestServices } from '../../testing/viewServices'
import { renderPortalMarkup } from '../../testing/renderPortalMarkup'
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type { JobRole, JobRoleFields } from '../../../shared/jobs'
import { JobDetailModal } from './JobDetailModal'

const ROLE: JobRole = {
  id: 'job-1',
  company: 'Notion',
  role: 'SWE Intern',
  location: '',
  postingLink: '',
  datePosted: null,
  stage: 'interview_1',
  appliedDate: '2026-08-10',
  oaDueDate: null,
  interview1Date: null,
  interview2Date: null,
  interview3Date: null,
  decisionDate: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z'
}

describe('JobDetailModal', () => {
  it.each(['interview', 'decided'] as const)('requires a choice before saving a drop into %s', async stageRequest => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saves: JobRoleFields[] = []
    let closed = false
    try {
      await act(async () => root.render(<ViewTestServices><JobDetailModal role={ROLE} open stageRequest={stageRequest}
        onClose={() => { closed = true }} onSave={async (_id, fields) => { saves.push(fields) }} /></ViewTestServices>))
      const save = document.querySelector<HTMLButtonElement>('[data-testid="jobdetail-save"]')
      const close = document.querySelector<HTMLButtonElement>('[aria-label="Close role details"]')
      if (save === null || close === null) throw new Error('Role dialog actions did not mount')
      expect(save.disabled).toBe(true)
      await act(async () => save.click())
      expect(saves).toHaveLength(0)
      await act(async () => close.click())
      expect(closed).toBe(true)
      expect(saves).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('keeps an OA move local until Save and retains dates and hiring cycle', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const saves: { id: string; fields: JobRoleFields; revision: number | undefined }[] = []
    const role: JobRole = { ...ROLE, stage: 'to_apply', oaDueDate: '2026-09-15', term: 'Summer 2027', revision: 4 }
    try {
      await act(async () => root.render(<ViewTestServices><JobDetailModal role={role} open stageRequest="oa"
        onClose={() => undefined} onSave={async (id, fields, revision) => { saves.push({ id, fields, revision }) }} /></ViewTestServices>))
      expect(saves).toHaveLength(0)
      expect(document.querySelector('[aria-labelledby="jobdetail-move-title"] [aria-label^="OA due date"]')).not.toBeNull()
      const save = document.querySelector<HTMLButtonElement>('[data-testid="jobdetail-save"]')
      if (save === null) throw new Error('Role save action did not mount')
      await act(async () => save.click())
      expect(saves).toHaveLength(1)
      expect(saves[0]).toMatchObject({ id: role.id, revision: 4, fields: {
        stage: 'oa', oaDueDate: '2026-09-15', appliedDate: ROLE.appliedDate, decisionDate: null, term: 'Summer 2027'
      } })
      expect(role.stage).toBe('to_apply')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('renders the same complete editable schema for an interview role', async () => {
    const markup = await renderPortalMarkup(
      <ViewTestServices><JobDetailModal role={ROLE} open stageRequest={null} onClose={() => undefined} onSave={async () => undefined} /></ViewTestServices>
    )
    ;[
      'Company',
      'Role',
      'Location',
      'Posting link',
      'Date posted',
      'Applied date',
      'OA due date',
      'Round 1 interview date',
      'Round 2 interview date',
      'Round 3 interview date',
      'Decision date'
    ].forEach((label) => expect(markup).toContain(`aria-label="${label}`))
    expect(markup).toContain('aria-label="Stage: Interview 1"')
    expect(markup).toContain('Sign in to attach resume versions.')
    expect(markup).toContain('ui-pill--tag is-plum')
    expect(markup).not.toContain('type="date"')
    expect(markup).not.toContain('jobdetail-stage')
    expect(markup).not.toContain('Notes')
  })
})
