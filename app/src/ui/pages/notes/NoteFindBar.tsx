import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'

const FIND_HIGHLIGHT = 'note-find'
const FIND_ACTIVE_HIGHLIGHT = 'note-find-active'

interface NoteFindBarProps {
  /** The editor DOM to search (the note body). */
  targetRef: RefObject<HTMLElement | null>
  /** Bumps whenever the note's content changes, so matches recompute. */
  contentVersion: string
  onClose: () => void
}

/** Find across inline formatting boundaries without matching editor controls or separate blocks. */
export function findMatches(root: HTMLElement, query: string): Range[] {
  if (query === '') return []
  const groups = new Map<Element, Text[]>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent === null || parent.closest('style,script,button,input,select,textarea,.note-layout-controls,.note-tab-title')) continue
    const block = parent.closest('.bn-inline-content,p,li,h1,h2,h3,h4,pre,td,figcaption') ?? root
    groups.set(block, [...(groups.get(block) ?? []), node as Text])
  }
  const ranges: Range[] = []
  for (const nodes of groups.values()) {
    const text = nodes.map((node) => node.data).join('')
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
      let offset = 0
      const range = new Range()
      let started = false
      for (const node of nodes) {
        const end = offset + node.length
        if (!started && match.index < end) { range.setStart(node, match.index - offset); started = true }
        if (started && match.index + match[0].length <= end) {
          range.setEnd(node, match.index + match[0].length - offset)
          ranges.push(range)
          break
        }
        offset = end
      }
    }
  }
  return ranges
}

function clearFindHighlights(): void {
  CSS.highlights.delete(FIND_HIGHLIGHT)
  CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT)
}

/** The in-note find bar (Cmd+F): floats over the editor, highlights every
    match through the CSS Custom Highlight API (the editor DOM is never
    touched), Enter walks forward, Shift+Enter back, Escape closes. */
export function NoteFindBar({ targetRef, contentVersion, onClose }: NoteFindBarProps): ReactNode {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const rangesRef = useRef<readonly Range[]>([])
  /* Scrolling happens on navigation and new queries only; retyping in the
     editor re-registers highlights without yanking the scroll position. */
  const scrollPendingRef = useRef(false)

  useEffect(() => {
    const root = targetRef.current
    if (root === null || query === '') {
      rangesRef.current = []
      setMatchCount(0)
      setActiveIndex(0)
      clearFindHighlights()
      return
    }
    const ranges = findMatches(root, query)
    rangesRef.current = ranges
    setMatchCount(ranges.length)
    setActiveIndex((current) => (ranges.length === 0 ? 0 : Math.min(current, ranges.length - 1)))
    CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...ranges))
  }, [query, contentVersion, targetRef])

  useEffect(() => {
    const active = rangesRef.current[activeIndex]
    if (active === undefined) {
      CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT)
      return
    }
    CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new Highlight(active))
    if (scrollPendingRef.current) {
      scrollPendingRef.current = false
      const element = active.startContainer.parentElement
      const blockId = element?.closest<HTMLElement>('.bn-block[data-id]')?.dataset.id
      if (blockId !== undefined) window.dispatchEvent(new CustomEvent('manor:reveal-block', { detail: blockId }))
      window.requestAnimationFrame(() => element?.scrollIntoView({ block: 'center' }))
    }
  }, [activeIndex, matchCount, contentVersion])

  useEffect(() => clearFindHighlights, [])

  const step = (delta: number): void => {
    if (matchCount === 0) return
    scrollPendingRef.current = true
    setActiveIndex((current) => (current + delta + matchCount) % matchCount)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="notes-find-bar" role="search" aria-label="Find in note">
      <input
        autoFocus
        value={query}
        placeholder="Find in note"
        aria-label="Find in note"
        onChange={(event) => {
          scrollPendingRef.current = true
          setActiveIndex(0)
          setQuery(event.target.value)
        }}
        onKeyDown={onInputKeyDown}
      />
      <span className="notes-find-count tnum" aria-live="polite">
        {query === '' ? '' : matchCount === 0 ? 'No matches' : `${activeIndex + 1} of ${matchCount}`}
      </span>
      <button type="button" aria-label="Previous match" disabled={matchCount === 0} onClick={() => step(-1)}>
        <ChevronUp size={14} />
      </button>
      <button type="button" aria-label="Next match" disabled={matchCount === 0} onClick={() => step(1)}>
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label="Close find" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
