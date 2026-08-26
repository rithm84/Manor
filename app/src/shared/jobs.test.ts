import { describe, expect, it } from 'vitest'

import { jobLocalDate, parseJobRole, parseJobRoleFields, parseJobsSeed } from './jobs'

const FIELDS = {
  company: 'OpenAI',
  role: 'SWE Intern',
  location: 'San Francisco, CA',
  postingLink: 'https://openai.com/careers/example',
  datePosted: '2026-08-14',
  stage: 'interview_2',
  appliedDate: '2026-08-17',
  oaDueDate: '2026-08-20',
  interview1Date: '2026-08-22',
  interview2Date: '2026-08-29',
  interview3Date: null,
  decisionDate: null,
  resumeId: null
} as const

describe('jobs validation', () => {
  it('derives the local calendar date without UTC rollover', () => {
    expect(jobLocalDate(new Date(2026, 7, 22, 23, 30))).toBe('2026-08-22')
  })

  it('keeps one complete property schema at every stage', () => {
    expect(parseJobRoleFields(FIELDS)).toEqual(FIELDS)
    expect(parseJobRoleFields({
      ...FIELDS,
      stage: 'to_apply',
      appliedDate: null,
      oaDueDate: null,
      interview1Date: null,
      interview2Date: null
    })).toMatchObject({ stage: 'to_apply', appliedDate: null, interview2Date: null })
  })

  it('normalizes the applied resume version reference', () => {
    const withoutResume = Object.fromEntries(
      Object.entries(FIELDS).filter(([key]) => key !== 'resumeId')
    )
    expect(parseJobRoleFields(withoutResume).resumeId).toBeNull()
    expect(parseJobRoleFields({ ...FIELDS, resumeId: ' resume-1 ' }).resumeId).toBe('resume-1')
    expect(() => parseJobRoleFields({ ...FIELDS, resumeId: '' })).toThrow(/job.resumeId/)
  })

  it('rejects unsupported stages and unsafe posting links', () => {
    expect(() => parseJobRoleFields({ ...FIELDS, stage: 'interview' })).toThrow(/must be one of/)
    expect(() => parseJobRoleFields({ ...FIELDS, postingLink: 'javascript:alert(1)' })).toThrow(/http or https/)
  })

  it('accepts unset optional properties and validates transition references', () => {
    const role = parseJobRole({
      id: 'job-1',
      ...FIELDS,
      location: '',
      postingLink: '',
      datePosted: null,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z'
    })
    expect(role.location).toBe('')
    expect(() => parseJobsSeed({
      today: '2026-08-20',
      roles: [role],
      transitions: [{
        id: 'transition-1',
        roleId: 'missing',
        fromStage: null,
        toStage: 'to_apply',
        changedAt: '2026-08-20T10:00:00.000Z'
      }]
    })).toThrow(/references missing role/)
  })
})
