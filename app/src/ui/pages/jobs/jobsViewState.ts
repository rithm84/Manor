import { useSyncExternalStore } from 'react'

import type { BrowseFilterRule } from './browseFilters'

/**
 * Session-scoped Jobs view state. Leaving the page and coming back keeps the
 * chosen view and the Browse search and filters; a reload or app restart
 * clears them, because the store is a module binding rather than storage.
 */

/** Top-level Jobs tabs: the pipeline (board + flow) or the listings feed. */
export type JobsView = 'pipeline' | 'browse'
/** How the pipeline itself is drawn. */
export type PipelineView = 'board' | 'flow'

interface JobsSessionState {
  view: JobsView
  pipelineView: PipelineView
  browseQuery: string
  browseRules: readonly BrowseFilterRule[]
}

/** Same-window change signal; the store never crosses windows. */
const JOBS_VIEW_CHANGE_EVENT = 'manor:jobs-view-change'

const EMPTY_RULES: readonly BrowseFilterRule[] = []

let sessionState: JobsSessionState = {
  view: 'pipeline',
  pipelineView: 'board',
  browseQuery: '',
  browseRules: EMPTY_RULES
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(JOBS_VIEW_CHANGE_EVENT, onChange)
  return (): void => {
    window.removeEventListener(JOBS_VIEW_CHANGE_EVENT, onChange)
  }
}

/** Writes replace the whole record, so every getSnapshot stays referentially stable. */
function write(next: JobsSessionState): void {
  sessionState = next
  window.dispatchEvent(new Event(JOBS_VIEW_CHANGE_EVENT))
}

function readView(): JobsView {
  return sessionState.view
}

function readPipelineView(): PipelineView {
  return sessionState.pipelineView
}

function readBrowseQuery(): string {
  return sessionState.browseQuery
}

function readBrowseRules(): readonly BrowseFilterRule[] {
  return sessionState.browseRules
}

function writeView(view: JobsView): void {
  write({ ...sessionState, view })
}

function writePipelineView(pipelineView: PipelineView): void {
  write({ ...sessionState, pipelineView })
}

function writeBrowseQuery(browseQuery: string): void {
  write({ ...sessionState, browseQuery })
}

function writeBrowseRules(browseRules: readonly BrowseFilterRule[]): void {
  write({ ...sessionState, browseRules })
}

/** Active Jobs tab; survives navigation, resets to the pipeline on reload. */
export function useJobsView(): readonly [JobsView, (view: JobsView) => void] {
  const view = useSyncExternalStore(subscribe, readView)
  return [view, writeView] as const
}

/** Board or flow within the pipeline tab, kept for the session too. */
export function usePipelineView(): readonly [PipelineView, (view: PipelineView) => void] {
  const pipelineView = useSyncExternalStore(subscribe, readPipelineView)
  return [pipelineView, writePipelineView] as const
}

/** Browse search text, kept for the session alongside the view. */
export function useBrowseQuery(): readonly [string, (query: string) => void] {
  const query = useSyncExternalStore(subscribe, readBrowseQuery)
  return [query, writeBrowseQuery] as const
}

/** Browse filter rules, kept for the session alongside the view. */
export function useBrowseRules(): readonly [
  readonly BrowseFilterRule[],
  (rules: readonly BrowseFilterRule[]) => void
] {
  const rules = useSyncExternalStore(subscribe, readBrowseRules)
  return [rules, writeBrowseRules] as const
}

/** Test-only reset; production code never needs to clear the store by hand. */
export function resetJobsViewState(): void {
  write({ view: 'pipeline', pipelineView: 'board', browseQuery: '', browseRules: EMPTY_RULES })
}
