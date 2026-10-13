import { useEffect, useState } from 'react'
import type { PROBLEM_COLUMNS } from '../../../shared/problemLibrary'

export type ProblemColumn = typeof PROBLEM_COLUMNS[number]

/** Fixed widths in pixels; the Problem column takes the rest of the row. */
export const problemColumnWidths: Readonly<Record<ProblemColumn, number>> = { difficulty: 96, kind: 104, topics: 232, companies: 200, tags: 176, collections: 208, status: 120, lastAsked: 136 }
/** Room for the single source-link action. */
export const problemActionsWidth = 48
const problemNameMinimum = 300
/** Columns give way from the end of this list first, so status and difficulty stay longest. */
const columnPriority: readonly ProblemColumn[] = ['status', 'difficulty', 'companies', 'topics', 'lastAsked', 'tags', 'kind', 'collections']

/** The chosen columns that fit beside a readable Problem column, keeping the chosen order. */
export function fittingColumns(columns: readonly ProblemColumn[], width: number): readonly ProblemColumn[] {
  const kept = new Set(columns)
  const total = (): number => [...kept].reduce((sum, column) => sum + problemColumnWidths[column], problemActionsWidth + problemNameMinimum)
  for (const column of [...columnPriority].reverse()) {
    if (total() <= width) break
    kept.delete(column)
  }
  return columns.filter(column => kept.has(column))
}

/** A callback ref and the element's content width, updated as it resizes; null until first measured. */
export function useElementWidth(): [(node: HTMLElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (node === null) return
    const observer = new ResizeObserver(entries => { const entry = entries[entries.length - 1]; if (entry !== undefined) setWidth(entry.contentRect.width) })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}

/**
 * How many whole chips fit in a row of `available` pixels, leaving room for a "+N" counter of width `counter`
 * whenever some chips are left out. Chips are never cut, so a chip that does not fit moves into the counter.
 */
export function fittingChipCount(widths: readonly number[], gap: number, counter: number, available: number): number {
  const span = (count: number): number => widths.slice(0, count).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, count - 1)
  if (span(widths.length) <= available) return widths.length
  for (let count = widths.length - 1; count > 0; count -= 1) if (span(count) + gap + counter <= available) return count
  return 0
}
