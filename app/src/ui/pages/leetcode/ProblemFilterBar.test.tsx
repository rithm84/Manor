// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { emptyProblemFilters, filterProblems } from '../../../shared/problemLibrary'
import type { ProblemFilters, ProblemRecord } from '../../../shared/problemLibrary'
import { ProblemFilterBar } from './ProblemFilterBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function problem(id: string, topics: string[], tags: string[]): ProblemRecord {
  return { id, name: id, difficulty: 'Easy', kind: 'coding', topics, companies: [], tags, collections: [], sourceUrl: null, sourceType: 'custom', externalKey: null, contentAvailable: false, contentVersion: 0, revision: 1, status: 'unattempted', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
}

describe('ProblemFilterBar', () => {
  it('edits only its own facet, keeps other tag facets, and clears everything it owns', async () => {
    const problems = [problem('a', ['Arrays', 'Graph modeling'], ['Round: Onsite', 'Role: Backend']), problem('b', ['Arrays'], ['Round: Phone screen'])]
    const filters: ProblemFilters = { ...emptyProblemFilters(), tags: ['Role: Backend'] }
    const onFilters = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<ProblemFilterBar problems={problems} filters={filters} onFilters={onFilters} />))
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="problem-filter-round"]')?.click())
      const round = document.querySelector('[data-testid="problem-filter-round-menu"]')
      expect(round?.textContent).toContain('Onsite1')
      const onsite = [...(round?.querySelectorAll('label') ?? [])].find(label => label.textContent?.startsWith('Onsite'))?.querySelector('input')
      await act(async () => onsite?.click())
      expect(onFilters).toHaveBeenLastCalledWith({ ...filters, tags: ['Role: Backend', 'Round: Onsite'] })

      await act(async () => root.render(<ProblemFilterBar problems={problems} filters={{ ...filters, topics: ['Graph modeling'], tags: ['Role: Backend', 'Round: Onsite'] }} onFilters={onFilters} />))
      expect(host.querySelector('[data-testid="problem-filter-topics"]')?.textContent).toBe('Topics · 1')
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="problem-filter-reset"]')?.click())
      expect(onFilters).toHaveBeenLastCalledWith({ ...filters, topics: [], tags: ['Role: Backend'] })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('offers topic categories over their patterns, and a category matches any of its patterns', async () => {
    const problems = [problem('a', ['Sliding window: fixed', 'Arrays'], []), problem('b', ['Sliding window: variable'], []), problem('c', ['Tries'], [])]
    const onFilters = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<ProblemFilterBar problems={problems} filters={emptyProblemFilters()} onFilters={onFilters} />))
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="problem-filter-topics"]')?.click())
      const menu = document.querySelector('[data-testid="problem-filter-topics-menu"]')
      const rows = [...(menu?.querySelectorAll('.problem-filter-group > .problem-filter-row') ?? [])].map(row => row.textContent)
      expect(rows).toEqual(['Arrays & Hashing1', 'Sliding Window2', 'Tries1'])
      expect(menu?.querySelector('[aria-label="Show Tries patterns"]')).toBeNull()
      await act(async () => menu?.querySelector<HTMLButtonElement>('[aria-label="Show Sliding Window patterns"]')?.click())
      expect([...(menu?.querySelectorAll('.problem-filter-children label') ?? [])].map(label => label.textContent)).toEqual(['Sliding window: fixed1', 'Sliding window: variable1'])
      const category = [...(menu?.querySelectorAll('label') ?? [])].find(label => label.textContent?.startsWith('Sliding Window'))?.querySelector('input')
      await act(async () => category?.click())
      expect(onFilters).toHaveBeenLastCalledWith({ ...emptyProblemFilters(), topics: ['Sliding Window'] })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
    const sort = [{ field: 'name' as const, direction: 'asc' as const }]
    expect(filterProblems(problems, { ...emptyProblemFilters(), topics: ['Sliding Window'] }, sort).map(item => item.id)).toEqual(['a', 'b'])
    expect(filterProblems(problems, { ...emptyProblemFilters(), topics: ['Sliding window: variable', 'Tries'] }, sort).map(item => item.id)).toEqual(['b', 'c'])
  })
})
