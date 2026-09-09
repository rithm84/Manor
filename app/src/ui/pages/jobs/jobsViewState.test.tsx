// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import type { BrowseFilterRule } from './browseFilters'
import { resetJobsViewState, useBrowseRules, useJobsView, usePipelineView } from './jobsViewState'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type JobsViewSetter = (view: 'pipeline' | 'browse') => void

let viewSet: JobsViewSetter | null = null
let pipelineSet: ((view: 'board' | 'flow') => void) | null = null
let rulesSet: ((rules: readonly BrowseFilterRule[]) => void) | null = null
let ruleSnapshots: (readonly BrowseFilterRule[])[] = []

/** Stands in for the tab strip: reads the view only. */
function ViewReader(): ReactNode {
  const [view] = useJobsView()
  return <span>{view}</span>
}

/** Stands in for the Browse table: reads rules, writes both. */
function BrowseSurface(): ReactNode {
  const [, setView] = useJobsView()
  const [, setPipelineView] = usePipelineView()
  const [rules, setRules] = useBrowseRules()
  viewSet = setView
  pipelineSet = setPipelineView
  rulesSet = setRules
  ruleSnapshots.push(rules)
  return <span data-testid="rules">{rules.length}</span>
}

describe('jobs session view state', () => {
  beforeEach(() => {
    resetJobsViewState()
    viewSet = null
    pipelineSet = null
    rulesSet = null
    ruleSnapshots = []
  })

  it('starts on the pipeline, live-syncs every subscriber, and survives remounting', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <>
          <ViewReader />
          <BrowseSurface />
        </>
      )
    })
    expect(container.textContent).toBe('pipeline0')

    act(() => {
      viewSet?.('browse')
    })
    expect(container.textContent).toBe('browse0')

    const rules: readonly BrowseFilterRule[] = [{ id: 'company', property: 'company', value: 'Ramp' }]
    act(() => {
      rulesSet?.(rules)
    })
    expect(container.textContent).toBe('browse1')

    // Navigating away and back is an unmount/remount, not a reload.
    act(() => {
      root.unmount()
    })
    const remounted = createRoot(container)
    act(() => {
      remounted.render(
        <>
          <ViewReader />
          <BrowseSurface />
        </>
      )
    })
    expect(container.textContent).toBe('browse1')

    act(() => {
      remounted.unmount()
    })
    container.remove()
  })

  it('hands out a referentially stable rules snapshot between writes', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<BrowseSurface />)
    })
    act(() => {
      pipelineSet?.('flow')
    })
    // A view write re-renders the rules reader; the snapshot must be identical
    // or useSyncExternalStore loops forever.
    expect(ruleSnapshots.length).toBeGreaterThan(1)
    expect(new Set(ruleSnapshots).size).toBe(1)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
