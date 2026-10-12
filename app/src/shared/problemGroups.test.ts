import { describe, expect, it } from 'vitest'
import { emptyProblemFilters } from './problemLibrary'
import type { ProblemRecord } from './problemLibrary'
import { filterProblemGroups, problemGroups } from './problemGroups'
import { affectedTables } from '../web/gatewayQueries'

const canonical: ProblemRecord = {
  id: 'main', name: 'Add two integers', sourceName: 'Original sum title', canonicalProblemId: null,
  difficulty: 'Easy', kind: 'coding', topics: ['Mathematics'], companies: ['First company'], tags: [], collections: ['Practice'],
  sourceUrl: 'https://example.com/main', sourceType: 'imported', externalKey: 'main-source', contentAvailable: true, contentVersion: 2,
  revision: 4, status: 'unattempted', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  sourceMetadata: { lastAsked: { value: '2026-10-01', precision: 'day' }, reportCount: 3 }
}
const alias: ProblemRecord = {
  ...canonical, id: 'retained', name: 'Another source sum title', sourceName: 'Earlier addition question', canonicalProblemId: 'main',
  topics: ['Arithmetic'], companies: ['Second company'], tags: ['Reviewed'], collections: ['Interview'], contentVersion: 1,
  sourceMetadata: { lastAsked: { value: '2026-09', precision: 'month' }, reportCount: 2, snapshots: [{ sourceUrl: 'https://example.com/retained', snapshotDate: '2026-09-19' }] }
}

describe('retained problem sources', () => {
  it('projects one canonical row with union labels and source evidence while keeping raw records unchanged', () => {
    const before = structuredClone([canonical, alias])
    const groups = problemGroups([canonical, alias])
    expect(groups).toHaveLength(1)
    expect(groups[0].sources).toEqual([canonical, alias])
    expect(groups[0].problem.companies).toEqual(['First company', 'Second company'])
    expect(groups[0].problem.topics).toEqual(['Arithmetic', 'Mathematics'])
    expect(groups[0].problem.sourceMetadata).toMatchObject({ lastAsked: canonical.sourceMetadata?.lastAsked, reportCount: 3, snapshots: alias.sourceMetadata?.snapshots })
    expect([canonical, alias]).toEqual(before)
  })
  it('matches an older source date, alias title, and alias labels without exposing a second row', () => {
    const groups = problemGroups([canonical, alias])
    const filters = { ...emptyProblemFilters(), search: 'Earlier addition', companies: ['Second company'], lastAskedSince: '2026-09-15', lastAskedUntil: '2026-09-20' }
    expect(filterProblemGroups(groups, filters, [{ field: 'lastAsked', direction: 'desc' }]).map(problem => problem.id)).toEqual(['main'])
    expect(filterProblemGroups(groups, { ...filters, lastAskedSince: '2026-08-01', lastAskedUntil: '2026-08-31' }, [{ field: 'name', direction: 'asc' }])).toEqual([])
  })
  it('unmerging restores both rows and rejects an incomplete or nested group', () => {
    expect(problemGroups([canonical, { ...alias, canonicalProblemId: null }])).toHaveLength(2)
    expect(() => problemGroups([alias])).toThrow(/canonical problem.*unavailable/)
    expect(() => problemGroups([canonical, alias, { ...alias, id: 'nested', canonicalProblemId: alias.id }])).toThrow(/canonical problem.*unavailable/)
    expect(affectedTables('merge_problem_duplicates')).toEqual(['leetcode_problems', 'action_events'])
    expect(affectedTables('unmerge_problem_duplicate')).toEqual(['leetcode_problems', 'action_events'])
  })
})
