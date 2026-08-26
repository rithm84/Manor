import { afterEach, describe, expect, it } from 'vitest'

import type { JobRole, JobsSeed } from '../shared/jobs'
import { JobStore } from './jobStore'

const ROLE: JobRole = {
  id: 'job-openai',
  company: 'OpenAI',
  role: 'SWE Intern',
  location: 'San Francisco, CA',
  postingLink: 'https://openai.com/careers/example',
  datePosted: '2026-08-14',
  stage: 'applied',
  appliedDate: '2026-08-17',
  oaDueDate: null,
  interview1Date: null,
  interview2Date: null,
  interview3Date: null,
  decisionDate: null,
  createdAt: '2026-08-14T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z'
}

const SEED: JobsSeed = {
  today: '2026-08-20',
  roles: [ROLE],
  transitions: [{
    id: 'transition-1',
    roleId: ROLE.id,
    fromStage: 'to_apply',
    toStage: 'applied',
    changedAt: '2026-08-17T12:00:00.000Z'
  }]
}

let store: JobStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

describe('JobStore', () => {
  it('persists the complete role property schema', () => {
    store = new JobStore(':memory:')
    store.load(SEED, '2026-08-20')

    const state = store.updateRole({
      id: ROLE.id,
      fields: {
        company: 'OpenAI',
        role: 'SWE Intern, Applied',
        location: 'Remote',
        postingLink: 'https://openai.com/careers/updated',
        datePosted: '2026-08-13',
        stage: 'interview_2',
        appliedDate: '2026-08-17',
        oaDueDate: '2026-08-20',
        interview1Date: '2026-08-22',
        interview2Date: '2026-08-29',
        interview3Date: null,
        decisionDate: null
      }
    }, '2026-08-21T12:00:00.000Z')

    expect(state.roles[0]).toMatchObject({
      role: 'SWE Intern, Applied',
      location: 'Remote',
      stage: 'interview_2',
      interview1Date: '2026-08-22',
      interview2Date: '2026-08-29'
    })
    expect(state.transitions.at(-1)).toMatchObject({
      fromStage: 'applied',
      toStage: 'interview_2'
    })
  })

  it('appends durable history for every actual stage change', () => {
    store = new JobStore(':memory:')
    store.load(SEED, '2026-08-20')

    const moved = store.setStage(
      { id: ROLE.id, stage: 'oa' },
      '2026-08-20T15:00:00.000Z'
    )
    expect(moved.transitions).toHaveLength(2)
    expect(moved.transitions.at(-1)).toMatchObject({ fromStage: 'applied', toStage: 'oa' })

    const unchanged = store.setStage(
      { id: ROLE.id, stage: 'oa' },
      '2026-08-20T15:01:00.000Z'
    )
    expect(unchanged.transitions).toHaveLength(2)

    const reloaded = store.load({ ...SEED, roles: [], transitions: [] }, '2026-08-21')
    expect(reloaded.roles[0]?.stage).toBe('oa')
    expect(reloaded.transitions).toHaveLength(2)
    expect(reloaded.today).toBe('2026-08-21')
  })

  it('round-trips the applied resume version and defaults legacy roles to null', () => {
    store = new JobStore(':memory:')
    const loaded = store.load(SEED, '2026-08-20')
    expect(loaded.roles[0]?.resumeId).toBeNull()

    const updated = store.updateRole({
      id: ROLE.id,
      fields: { ...ROLE, resumeId: 'resume-2026-swe' }
    }, '2026-08-21T12:00:00.000Z')
    expect(updated.roles[0]?.resumeId).toBe('resume-2026-swe')

    const reloaded = store.load({ ...SEED, roles: [], transitions: [] }, '2026-08-22')
    expect(reloaded.roles[0]?.resumeId).toBe('resume-2026-swe')
  })

  it('creates roles without inventing a posted or stage date', () => {
    store = new JobStore(':memory:')
    store.load({ today: '2026-08-20', roles: [], transitions: [] }, '2026-08-20')

    const state = store.createRole({
      company: 'Anthropic',
      role: 'Research Engineer',
      location: 'San Francisco, CA',
      postingLink: '',
      datePosted: null,
      stage: 'to_apply',
      appliedDate: null,
      oaDueDate: null,
      interview1Date: null,
      interview2Date: null,
      interview3Date: null,
      decisionDate: null
    }, '2026-08-20T16:00:00.000Z')

    expect(state.roles[0]).toMatchObject({ datePosted: null, appliedDate: null })
    expect(state.transitions[0]).toMatchObject({ fromStage: null, toStage: 'to_apply' })
  })
})
