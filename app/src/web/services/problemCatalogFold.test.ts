import { describe, expect, it } from 'vitest'

import type { JsonObject } from '../ManorGateway'
import { libraryRecords, practiceState, problemDetail, problemStatus } from './problemCatalogFold'

const ACCOUNT = '0f4b1d2a-6c38-4a1e-9d77-2b5c8e4f10aa'

function problem(id: string, fields: JsonObject): JsonObject {
  return {
    id, name: 'Two Sum', difficulty: 'Easy', kind: 'coding', topics: ['Arrays'], companies: [], tags: [], collections: [],
    source_url: null, source_type: 'stock', external_key: `leetcode:${id}`, source_metadata: {}, canonical_problem_id: null,
    source_name: null, duplicate_reason: null, content_available: true, content_version: 1, grading_version: 1, revision: 1,
    user_id: null, created_at: '2026-10-12T05:05:23.77538+00:00', updated_at: '2026-10-12T23:18:31.022292+00:00', ...fields
  }
}

function content(problemId: string, version: number): JsonObject {
  return {
    problem_id: problemId, version, statement_markdown: `Statement of ${problemId}`, examples: [], hints: [], solution_markdown: null,
    starter_code: { python: 'class Solution:\n    pass\n' }, interface: null, created_at: '2026-10-12T05:05:23.77538+00:00', user_id: null
  }
}

const stock = problem('two-sum', { topics: ['Arrays', 'Hash tables'], companies: ['Google'] })
const imported = problem('meta-two-sum', { source_type: 'imported', canonical_problem_id: 'two-sum', topics: ['Arrays'], companies: ['Meta'], tags: ['Round: Phone screen'], source_name: 'Meta: Two Sum', content_version: 2, grading_version: null })
const attempt = (problemId: string): { problemId: string } => ({ problemId })

describe('problem status', () => {
  it('comes from the problem itself: an attempt, else the recorded practice, else unattempted', () => {
    const state = practiceState([attempt('two-sum')], [{ user_id: ACCOUNT, problem_id: 'valid-anagram', status: 'attempted', revision: 1 }])
    expect(problemStatus('two-sum', state)).toBe('solved')
    expect(problemStatus('valid-anagram', state)).toBe('attempted')
    expect(problemStatus('group-anagrams', state)).toBe('unattempted')
  })

  it('ignores history on a retained source when showing its group', () => {
    // The account solved the imported source before it joined the stock problem; the group keeps the stock status.
    const state = practiceState([attempt('meta-two-sum')], [])
    const detail = problemDetail({ requested: imported, members: [stock, imported], content: content('two-sum', 1), requestedContent: content('meta-two-sum', 2) }, state)
    expect(detail.problem.status).toBe('unattempted')
    expect(detail.requestedProblem.status).toBe('solved')
    expect(detail.sourceRecords.map((record) => [record.id, record.status])).toEqual([['meta-two-sum', 'solved'], ['two-sum', 'unattempted']])
  })

  it('refuses a practice status the account cannot record', () => {
    expect(() => practiceState([], [{ problem_id: 'two-sum', status: 'unattempted' }])).toThrow()
  })
})

describe('the library', () => {
  it('lists catalog problems beside the account\'s custom ones', () => {
    const custom = problem('custom-1', { source_type: 'custom', user_id: ACCOUNT, external_key: null })
    const records = libraryRecords([stock, imported], [custom], practiceState([], []))
    expect(records.map((record) => [record.id, record.sourceType])).toEqual([['two-sum', 'stock'], ['meta-two-sum', 'imported'], ['custom-1', 'custom']])
  })

  it('refuses a custom problem that reuses a catalog id', () => {
    expect(() => libraryRecords([stock], [problem('two-sum', { source_type: 'custom', user_id: ACCOUNT })], practiceState([], []))).toThrow(/both a catalog problem and a custom problem/)
  })
})

describe('an open problem', () => {
  it('is its group\'s canonical problem with every member\'s labels, its statement, and the requested source', () => {
    const detail = problemDetail({ requested: imported, members: [imported, stock], content: content('two-sum', 1), requestedContent: content('meta-two-sum', 2) }, practiceState([], []))
    expect(detail.problem.id).toBe('two-sum')
    expect(detail.problem.companies).toEqual(['Google', 'Meta'])
    expect(detail.problem.topics).toEqual(['Arrays', 'Hash tables'])
    expect(detail.problem.tags).toEqual(['Round: Phone screen'])
    expect(detail.content?.statementMarkdown).toBe('Statement of two-sum')
    expect(detail.requestedId).toBe('meta-two-sum')
    expect(detail.requestedContent?.version).toBe(2)
    expect(detail.gradingAvailable).toBe(true)
    expect(detail.canExecute).toBe(true)
  })

  it('keeps a lone problem\'s own labels', () => {
    const lone = problem('valid-anagram', { topics: ['Strings', 'Hash tables'] })
    const detail = problemDetail({ requested: lone, members: [lone], content: content('valid-anagram', 1), requestedContent: content('valid-anagram', 1) }, practiceState([], []))
    expect(detail.problem.topics).toEqual(['Strings', 'Hash tables'])
    expect(detail.sourceRecords).toHaveLength(1)
  })

  it('offers grading only when the current statement has a testset, and running to custom problems with a statement', () => {
    const ungraded = problem('ungraded', { grading_version: null })
    const plain = problemDetail({ requested: ungraded, members: [ungraded], content: content('ungraded', 1), requestedContent: content('ungraded', 1) }, practiceState([], []))
    expect([plain.gradingAvailable, plain.canExecute]).toEqual([false, false])
    const custom = problem('custom-run', { source_type: 'custom', user_id: ACCOUNT, grading_version: null })
    const runnable = problemDetail({ requested: custom, members: [custom], content: content('custom-run', 1), requestedContent: content('custom-run', 1) }, practiceState([], []))
    expect([runnable.gradingAvailable, runnable.canExecute]).toEqual([false, true])
    const design = problem('design-feed', { kind: 'system_design', grading_version: 1 })
    expect(problemDetail({ requested: design, members: [design], content: null, requestedContent: null }, practiceState([], [])).canExecute).toBe(false)
  })

  it('needs its canonical problem among the members', () => {
    expect(() => problemDetail({ requested: imported, members: [imported], content: null, requestedContent: null }, practiceState([], []))).toThrow(/canonical problem two-sum/)
  })
})
