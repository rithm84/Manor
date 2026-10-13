import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../ManorGateway'
import { joinCatalogDetail, splitCatalogRow } from './catalogRows'

const SNAPSHOT = 'https://github.com/snehasishroy/leetcode-companywise-interview-questions/tree/e095c259cfd036e3ddb6886e84d7075c2faac477'

function report(company: string, window: string, snapshotDate: string): JsonObject {
  return { window, company, frequency: 12.5, sourceUrl: SNAPSHOT, acceptance: 84.4, snapshotDate, sourceRevision: 'e095c259cfd036e3ddb6886e84d7075c2faac477' }
}

/** A stock row in the shape staging's `problem_catalog` returns. */
function stockRow(id: string, reports: readonly JsonObject[]): JsonObject {
  return {
    id, kind: 'coding', name: 'Matrix Diagonal Sum', tags: [], topic: 'Arrays', topics: ['Matrices', 'Arrays'], revision: 5,
    companies: ['Amazon', 'Google', 'Meta', 'Microsoft'], created_at: '2026-10-12T05:05:23.77538+00:00', difficulty: 'Easy',
    source_url: 'https://leetcode.com/problems/matrix-diagonal-sum/', updated_at: '2026-10-12T23:18:31.022292+00:00', collections: [],
    source_name: null, source_type: 'stock', external_key: 'leetcode:1572', content_version: 1, grading_version: 1, user_id: null,
    source_metadata: { difficultySource: 'official', ...(reports.length === 0 ? {} : { companyReports: [...reports], snapshots: [{ revision: 'e095c259cfd036e3ddb6886e84d7075c2faac477', sourceUrl: SNAPSHOT, snapshotDate: '2026-07-12' }] }) },
    curriculum_order: 0, duplicate_reason: null, content_available: true, canonical_problem_id: null
  }
}

/** An imported row in the shape staging returns: no company reports or snapshots. */
function importedRow(id: string): JsonObject {
  return {
    id, kind: 'coding', name: 'Count Value Occurrences in a Binary Tree', tags: ['Role: Software engineer'], topic: 'Binary trees',
    topics: ['Binary trees', 'Counting', 'Recursion', 'Depth-first search'], revision: 3, companies: ['Apple'],
    created_at: '2026-10-12T04:55:22.831323+00:00', difficulty: 'Medium',
    source_url: 'https://example.com/interview/apple/count-value-occurrences-in-a-binary-tree', updated_at: '2026-10-12T08:14:30.085929+00:00',
    collections: ['Interview question bank'], source_name: null, source_type: 'imported',
    external_key: 'source:ad0a1dfbc4105fe68503942c1ec43c90c6169c2de0c28a28c2abe25b9fb774b0', content_version: 0, grading_version: null, user_id: null,
    source_metadata: { difficultySource: 'official' }, curriculum_order: 0, duplicate_reason: null, content_available: false, canonical_problem_id: null
  }
}

describe('catalog index rows', () => {
  it('keep only the report the recency column shows, and the detail row keeps every report and snapshot', () => {
    const reports = [report('Amazon', 'all', '2026-07-12'), report('Google', '6m', '2026-07-12'), report('Meta', '30d', '2026-04-01')]
    const row = stockRow('00125aac-8ac0-59f9-bb8e-0a3b2082fe5d', reports)
    const { index, detail } = splitCatalogRow(row)
    expect(index.key).toBe(row.id)
    expect(index.revision).toBe(5)
    // The newest snapshot wins, and within it the shorter window.
    expect(index.data.source_metadata).toEqual({ difficultySource: 'official', companyReports: [reports[1]] })
    expect(detail?.data).toEqual({ companyReports: reports, snapshots: (row.source_metadata as JsonObject).snapshots })
    expect(joinCatalogDetail(index.data, detail?.data ?? null)).toEqual(row)
  })

  it('need no detail row when a problem has no source evidence', () => {
    const row = importedRow('00007abd-ad0a-5acb-88ff-20e9b59680d1')
    expect(splitCatalogRow(row)).toEqual({ index: { key: row.id, data: row, revision: 3 }, detail: null })
    expect(joinCatalogDetail(row, null)).toBe(row)
  })

  it('refuse to present the single kept report as the whole list', () => {
    const { index } = splitCatalogRow(stockRow('lost-detail', [report('Amazon', 'all', '2026-07-12')]))
    expect(() => joinCatalogDetail(index.data, null)).toThrow(/lost its company reports/)
  })

  it('carry about half the bytes of a staging-sized catalog across to the library', () => {
    // Staging's catalog source, measured on 2026-10-13: 4,081 stock rows averaging 9.8 company reports (median 4,
    // 90th percentile 22, at most 287) of about 295 bytes each, and 9,118 imported rows of about 970 bytes with none.
    // Its full rows came to 24.4 MB as mirror rows and 12.8 MB once split this way.
    const counts = [0, 1, 2, 2, 3, 4, 4, 4, 5, 6, 8, 10, 12, 15, 22, 30, 40]
    const rows: JsonObject[] = []
    for (let index = 0; index < 4_081; index += 1) {
      const reports = Array.from({ length: counts[index % counts.length] }, (_, at) => report(`Company ${at}`, at % 2 === 0 ? 'all' : '6m', `2026-0${1 + (at % 7)}-12`))
      rows.push(stockRow(`stock-${index}`, reports))
    }
    for (let index = 0; index < 9_118; index += 1) rows.push(importedRow(`imported-${index}`))
    const full = JSON.stringify(rows.map((row) => ({ key: row.id, data: row, revision: row.revision }))).length
    const indexed = JSON.stringify(rows.map((row) => splitCatalogRow(row).index)).length
    expect(full).toBeGreaterThan(20_000_000)
    expect(full).toBeLessThan(30_000_000)
    expect(indexed / full).toBeLessThan(0.55)
  })
})
