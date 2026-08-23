import { Bookmark as BookmarkIcon, Search } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { EmptyState, Input } from '../components/ui'
import { bookmarkThemes, bookmarks } from '../data/mock'
import type { Bookmark } from '../data/mock'
import { BookmarkRow } from './bookmarks/BookmarkRow'
import './bookmarks/bookmarks.css'

/** Keywords each theme chip matches against a post's text and article title. */
const themeKeywords: Readonly<Record<string, readonly string[]>> = {
  'CUDA kernels': ['cuda', 'kernel', 'bank conflicts', 'compiler'],
  'Electron perf': ['electron', 'renderer', 'ipc', 'startup']
}

/**
 * One-line gists of articles captured alongside a post, keyed by bookmark id.
 * Display fixtures for the shell; the canonical bookmark data stays in mock.ts.
 */
const articleSummaries: Readonly<Record<string, string>> = {
  'bm-karpathy':
    'Walks through occupancy, memory coalescing, and when hand-tuning actually beats the compiler.',
  'bm-thorstenball':
    'A week of renderer profiling, and the three fixes that mattered were all in paint scheduling.'
}

function haystack(bookmark: Bookmark): string {
  const article = bookmark.linkedArticleTitle !== null ? bookmark.linkedArticleTitle : ''
  return `${bookmark.text} ${article} ${bookmark.authorHandle} ${bookmark.authorName}`.toLowerCase()
}

function matchesTheme(bookmark: Bookmark, theme: string): boolean {
  const keywords = themeKeywords[theme]
  if (keywords === undefined) {
    return false
  }
  const text = haystack(bookmark)
  return keywords.some((keyword) => text.includes(keyword))
}

/** Bookmarks: the X knowledge base as a compact, searchable list. */
export function BookmarksPage(): ReactNode {
  const [query, setQuery] = useState('')
  const [activeTheme, setActiveTheme] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const trimmed = query.trim().toLowerCase()
  const filtered = bookmarks.filter((bookmark) => {
    if (activeTheme !== null && !matchesTheme(bookmark, activeTheme)) {
      return false
    }
    if (trimmed !== '' && !haystack(bookmark).includes(trimmed)) {
      return false
    }
    return true
  })

  const filtering = trimmed !== '' || activeTheme !== null
  const countLabel = filtering
    ? `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`
    : null

  if (bookmarks.length === 0) {
    return (
      <div className="bm">
        <header className="bm-header">
          <div>
            <h1 className="bm-title display">Bookmarks</h1>
          </div>
        </header>
        <EmptyState
          icon={<BookmarkIcon size={20} />}
          title="Nothing saved yet"
          message="Your X bookmarks will appear here."
        />
      </div>
    )
  }

  return (
    <div className="bm">
      <header className="bm-header">
        <div>
          <h1 className="bm-title display">Bookmarks</h1>
          <span className="bm-meta tnum">{bookmarks.length} saved</span>
        </div>
      </header>

      <div className="bm-toolbar">
        <div className="bm-search">
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Find that post about…"
            icon={<Search size={15} />}
            ariaLabel="Search bookmarks"
          />
        </div>
        <div className="bm-filter-row" aria-label="Bookmark filters">
          <div className="bm-chips">
            <span className="bm-chips-label">Themes</span>
            {bookmarkThemes.map((theme) => (
              <button
                key={theme}
                type="button"
                className={`bm-chip${activeTheme === theme ? ' is-active' : ''}`}
                aria-pressed={activeTheme === theme}
                onClick={() => setActiveTheme(activeTheme === theme ? null : theme)}
              >
                {theme}
              </button>
            ))}
          </div>
          {countLabel !== null ? <span className="bm-count">{countLabel}</span> : null}
        </div>
      </div>

      <div className="bm-list">
        {filtered.length === 0 ? (
          <div className="bm-none">Nothing matches. Try fewer words.</div>
        ) : (
          filtered.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              articleSummary={articleSummaries[bookmark.id] ?? null}
              expanded={expandedId === bookmark.id}
              onToggle={() => setExpandedId(expandedId === bookmark.id ? null : bookmark.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
