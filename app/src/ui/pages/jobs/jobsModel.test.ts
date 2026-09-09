import { describe, expect, it } from 'vitest'

import type { JobRole, JobStageTransition } from '../../../shared/jobs'
import { currentUpdateLabel, fieldsForStageChange, jobFlowData, postedLabel, toBoardCard } from './jobsModel'

const ROLE: JobRole = {
  id: 'job-1',
  company: 'Databricks',
  role: 'SWE Intern',
  location: 'San Francisco, CA',
  postingLink: '',
  datePosted: '2026-08-14',
  stage: 'oa',
  appliedDate: '2026-08-17',
  oaDueDate: '2026-08-22',
  interview1Date: null,
  interview2Date: null,
  interview3Date: null,
  decisionDate: null,
  createdAt: '2026-08-14T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z'
}

describe('jobs presentation model', () => {
  it('shows only the current meaningful stage update', () => {
    expect(currentUpdateLabel(ROLE, '2026-08-20')).toBe('OA due Saturday')
    expect(currentUpdateLabel({ ...ROLE, oaDueDate: '2026-08-29' }, '2026-08-20')).toBe('OA due Aug 29')
    expect(currentUpdateLabel({ ...ROLE, oaDueDate: '2026-08-18' }, '2026-08-20')).toBe('OA overdue Aug 18')
    expect(currentUpdateLabel({ ...ROLE, stage: 'interview_2', interview2Date: null }, '2026-08-20')).toBe('Round 2 date not set')
  })

  it('uses sensible relative and absolute posting dates', () => {
    expect(postedLabel('2026-08-20', '2026-08-20')).toBe('Today')
    expect(postedLabel('2026-08-19', '2026-08-20')).toBe('Yesterday')
    expect(postedLabel('2026-08-18', '2026-08-20')).toBe('2d ago')
    expect(postedLabel('2026-07-30', '2026-08-20')).toBe('Jul 30')
  })

  it('assigns distinct semantic tones to active and decided updates', () => {
    expect(toBoardCard({ ...ROLE, stage: 'interview_1' }, '2026-08-20').detailTone).toBe('plum')
    expect(toBoardCard({ ...ROLE, stage: 'offer' }, '2026-08-20').detailTone).toBe('success')
    expect(toBoardCard({ ...ROLE, stage: 'rejected' }, '2026-08-20').detailTone).toBe('overdue')
  })

  it('drops corrected hops so the flow mirrors where roles actually stand', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-01T12:00:00.000Z' },
      { id: '2', roleId: 'b', fromStage: 'to_apply', toStage: 'applied', changedAt: '2026-08-02T12:00:00.000Z' },
      { id: '3', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-03T12:00:00.000Z' },
      { id: '4', roleId: 'a', fromStage: 'oa', toStage: 'rejected', changedAt: '2026-08-04T12:00:00.000Z' },
      { id: '5', roleId: 'b', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-05T12:00:00.000Z' },
      // b is dragged back to Applied: its OA visit was a mistake and vanishes.
      { id: '6', roleId: 'b', fromStage: 'oa', toStage: 'applied', changedAt: '2026-08-06T12:00:00.000Z' }
    ]
    const flow = jobFlowData(transitions)
    expect(flow.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceStage: 'applied', targetStage: 'oa', value: 1 }),
      expect.objectContaining({ sourceStage: 'oa', targetStage: 'rejected', value: 1 })
    ]))
    expect(flow.links).toHaveLength(2)
    expect(flow.nodes).not.toContainEqual(expect.objectContaining({ stage: 'to_apply' }))
  })

  it('empties the flow when a role is corrected all the way back', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-01T12:00:00.000Z' },
      { id: '2', roleId: 'a', fromStage: 'oa', toStage: 'interview_1', changedAt: '2026-08-01T12:01:00.000Z' },
      { id: '3', roleId: 'a', fromStage: 'interview_1', toStage: 'applied', changedAt: '2026-08-01T12:02:00.000Z' }
    ]
    expect(jobFlowData(transitions)).toEqual({ nodes: [], links: [] })
  })

  it('keeps the hiring cycle through a stage change', () => {
    const role: JobRole = { ...ROLE, term: 'Summer 2027' }
    const fields = fieldsForStageChange(role, 'interview_1', '2026-08-26')
    expect(fields.term).toBe('Summer 2027')
    expect(fields.appliedDate).toBe('2026-08-17')
  })

  it('counts a role once per edge however many times it was dragged back and forth', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-01T12:00:00.000Z' },
      { id: '2', roleId: 'a', fromStage: 'oa', toStage: 'applied', changedAt: '2026-08-01T12:01:00.000Z' },
      { id: '3', roleId: 'a', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-01T12:02:00.000Z' },
      { id: '4', roleId: 'a', fromStage: 'oa', toStage: 'interview_1', changedAt: '2026-08-01T12:03:00.000Z' },
      { id: '5', roleId: 'b', fromStage: 'applied', toStage: 'oa', changedAt: '2026-08-02T12:00:00.000Z' }
    ]
    const flow = jobFlowData(transitions)
    expect(flow.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceStage: 'applied', targetStage: 'oa', value: 2 }),
      expect.objectContaining({ sourceStage: 'oa', targetStage: 'interview_1', value: 1 })
    ]))
    expect(flow.links).toHaveLength(2)
  })

  it('omits stage corrections that would make the Sankey cyclic', () => {
    const transitions: readonly JobStageTransition[] = [
      { id: '1', roleId: 'a', fromStage: 'offer', toStage: 'rejected', changedAt: '2026-08-06T12:00:00.000Z' },
      { id: '2', roleId: 'b', fromStage: 'interview_2', toStage: 'applied', changedAt: '2026-08-07T12:00:00.000Z' }
    ]

    expect(jobFlowData(transitions)).toEqual({ nodes: [], links: [] })
  })
})
