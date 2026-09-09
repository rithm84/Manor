import { ViewTestServices } from '../../testing/viewServices'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { JobRole } from '../../../shared/jobs'
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
  it('renders the same complete editable schema for an interview role', () => {
    const markup = renderToStaticMarkup(
      <ViewTestServices><JobDetailModal role={ROLE} open onClose={() => undefined} onSave={async () => undefined} /></ViewTestServices>
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
    expect(markup).toContain('aria-label="Resume: None"')
    expect(markup).toContain('Upload new version')
    expect(markup).toContain('accept="application/pdf"')
    expect(markup).toContain('ui-pill--tag is-plum')
    expect(markup).not.toContain('type="date"')
    expect(markup).not.toContain('jobdetail-stage')
    expect(markup).not.toContain('Notes')
  })
})
