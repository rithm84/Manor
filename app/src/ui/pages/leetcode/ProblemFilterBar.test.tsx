// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { emptyProblemFilters } from '../../../shared/problemLibrary'
import type { ProblemFilters, ProblemRecord } from '../../../shared/problemLibrary'
import { ProblemFilterBar } from './ProblemFilterBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function problem(id: string, topics: string[], tags: string[]): ProblemRecord {
  return { id, name: id, difficulty: 'Easy', kind: 'coding', topics, companies: [], tags, collections: [], sourceUrl: null, sourceType: 'custom', externalKey: null, contentAvailable: false, contentVersion: 0, revision: 1, status: 'unattempted', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
}

describe('ProblemFilterBar', () => {
  it('edits only its own facet, keeps other tag facets, and clears everything it owns', async () => {
    const problems = [problem('a', ['Arrays', 'Graphs'], ['Round: Onsite', 'Role: Backend']), problem('b', ['Arrays'], ['Round: Phone screen'])]
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

      await act(async () => root.render(<ProblemFilterBar problems={problems} filters={{ ...filters, topics: ['Graphs'], tags: ['Role: Backend', 'Round: Onsite'] }} onFilters={onFilters} />))
      expect(host.querySelector('[data-testid="problem-filter-topics"]')?.textContent).toBe('Topics · 1')
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="problem-filter-reset"]')?.click())
      expect(onFilters).toHaveBeenLastCalledWith({ ...filters, topics: [], tags: ['Role: Backend'] })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
