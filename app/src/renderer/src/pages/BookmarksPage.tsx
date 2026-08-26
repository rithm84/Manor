import { Bookmark as BookmarkIcon, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { KbEntry } from '../../../shared/kb'
import type { XConnectionStatus } from '../../../shared/xConnection'
import { Button, EmptyState, Input, Modal } from '../components/ui'
import { bookmarkThemes, bookmarks } from '../data/mock'
import type { Bookmark } from '../data/mock'
import { BookmarkRow } from './bookmarks/BookmarkRow'
import { CaptureRow } from './bookmarks/CaptureRow'
import { matchesCaptureQuery } from './bookmarks/captures'
import { useCaptures } from './bookmarks/useCaptures'
import { xApiOf } from './bookmarks/xApi'
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

function entryHaystack(entry: KbEntry): string {
  return [entry.title, entry.author, entry.summary, entry.contentMd, entry.url]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()
}

function matchesEntryTheme(entry: KbEntry, theme: string): boolean {
  const keywords = themeKeywords[theme]
  if (keywords === undefined) {
    return false
  }
  const text = entryHaystack(entry)
  return keywords.some((keyword) => text.includes(keyword))
}

/** Bookmarks: the knowledge base as a compact, searchable list of X posts and captures. */
export function BookmarksPage(): ReactNode {
  const [query, setQuery] = useState('')
  const [activeTheme, setActiveTheme] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const captures = useCaptures()
  const [removeTarget, setRemoveTarget] = useState<KbEntry | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [xStatus, setXStatus] = useState<XConnectionStatus | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncNote, setSyncNote] = useState<{ text: string; failed: boolean } | null>(null)

  useEffect(() => {
    const api = xApiOf()
    if (api === null) return
    let cancelled = false
    api.status().then(
      (status) => {
        if (!cancelled) setXStatus(status)
      },
      (error: unknown) => {
        console.error('X connection status failed', { error })
      }
    )
    return (): void => {
      cancelled = true
    }
  }, [])

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

  const signedIn = captures.state.kind === 'ready'
  const allEntries = captures.state.kind === 'ready' ? captures.state.entries : []
  const screenEntries = allEntries.filter((entry) => entry.source === 'capture')
  const xEntries = allEntries.filter((entry) => entry.source === 'x_bookmark')
  // Live bookmarks replace the mock list once real ingested posts exist.
  const liveX = signedIn && xEntries.length > 0

  // Theme chips speak X-post language, so an active theme narrows to the X list.
  const visibleScreenEntries =
    activeTheme === null
      ? screenEntries.filter((entry) => matchesCaptureQuery(entry, trimmed))
      : []
  const visibleXEntries = xEntries.filter((entry) => {
    if (activeTheme !== null && !matchesEntryTheme(entry, activeTheme)) {
      return false
    }
    return matchesCaptureQuery(entry, trimmed)
  })

  const filtering = trimmed !== '' || activeTheme !== null
  const matchCount = (liveX ? visibleXEntries.length : filtered.length) + visibleScreenEntries.length
  const countLabel = filtering
    ? `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`
    : null
  const savedTotal = liveX ? allEntries.length : bookmarks.length + allEntries.length

  function closeRemove(): void {
    if (removeBusy) return
    setRemoveTarget(null)
    setRemoveError(null)
  }

  async function confirmRemove(): Promise<void> {
    if (removeTarget === null) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      await captures.removeCapture(removeTarget.id)
      setRemoveTarget(null)
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoveBusy(false)
    }
  }

  async function syncNow(): Promise<void> {
    const api = xApiOf()
    if (api === null || syncBusy) return
    setSyncBusy(true)
    setSyncNote(null)
    try {
      const { added } = await api.ingestNow()
      captures.reload()
      const text =
        added === 0 ? 'You are up to date.' : added === 1 ? '1 new bookmark.' : `${added} new bookmarks.`
      setSyncNote({ text, failed: false })
    } catch (error) {
      setSyncNote({
        text: error instanceof Error ? error.message : String(error),
        failed: true
      })
    } finally {
      setSyncBusy(false)
    }
  }

  function renderEntryRow(entry: KbEntry): ReactNode {
    return (
      <CaptureRow
        key={entry.id}
        entry={entry}
        expanded={expandedId === entry.id}
        onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
        onRetry={() => void captures.retryCapture(entry.id)}
        onRemoveRequest={() => {
          setRemoveError(null)
          setRemoveTarget(entry)
        }}
      />
    )
  }

  function renderCaptures(): ReactNode {
    if (activeTheme !== null) {
      return null
    }
    const { state } = captures
    let content: ReactNode
    if (state.kind === 'signedOut') {
      content = <div className="bm-cap-quiet">Sign in to see your captures.</div>
    } else if (state.kind === 'loading') {
      content = (
        <div className="bm-cap-skeleton" aria-hidden="true">
          <div className="bm-cap-skeleton-row">
            <span className="bm-skel-dot" />
            <span className="bm-skel-bar" style={{ width: '38%' }} />
          </div>
          <div className="bm-cap-skeleton-row">
            <span className="bm-skel-dot" />
            <span className="bm-skel-bar" style={{ width: '52%' }} />
          </div>
        </div>
      )
    } else if (state.kind === 'error') {
      content = (
        <div className="bm-cap-fault">
          <span className="bm-cap-fault-text">
            <span>Your captures did not load.</span>
            <span className="bm-cap-fault-detail">{state.message}</span>
          </span>
          <Button variant="ghost" onClick={captures.reload}>
            Try again
          </Button>
        </div>
      )
    } else if (screenEntries.length === 0) {
      content = <div className="bm-cap-quiet">Nothing captured yet.</div>
    } else if (visibleScreenEntries.length === 0) {
      // Entries exist but none match the search; the section steps aside.
      return null
    } else {
      content = (
        <>
          <div className="bm-list">{visibleScreenEntries.map(renderEntryRow)}</div>
          {state.notice !== null ? <div className="bm-cap-notice">{state.notice}</div> : null}
        </>
      )
    }
    return (
      <section className="bm-section">
        <span className="microlabel bm-section-label">Captures</span>
        {content}
      </section>
    )
  }

  function renderFromX(): ReactNode {
    const connected = xStatus !== null && xStatus.connected
    const header = (
      <div className="bm-section-head">
        <span className="microlabel bm-section-label">From X</span>
        {connected ? (
          <button
            type="button"
            className={`bm-sync${syncBusy ? ' is-busy' : ''}`}
            onClick={() => void syncNow()}
            disabled={syncBusy}
            aria-label="Sync X bookmarks"
            title="Sync now"
          >
            <RefreshCw size={13} />
          </button>
        ) : null}
        {syncNote !== null ? (
          <span className={`bm-sync-note${syncNote.failed ? ' is-failed' : ''}`}>{syncNote.text}</span>
        ) : null}
      </div>
    )

    if (liveX) {
      return (
        <section className="bm-section">
          {header}
          <div className="bm-list">
            {visibleXEntries.length === 0 ? (
              <div className="bm-none">Nothing matches. Try fewer words.</div>
            ) : (
              visibleXEntries.map(renderEntryRow)
            )}
          </div>
        </section>
      )
    }

    return (
      <section className="bm-section">
        {header}
        {signedIn && xStatus !== null && !connected ? (
          <div className="bm-x-hint">Connect X in Settings to sync your real bookmarks.</div>
        ) : null}
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
      </section>
    )
  }

  const removeDialog = (
    <Modal open={removeTarget !== null} onClose={closeRemove} width={400} ariaLabel="Remove capture">
      <div className="bm-dialog">
        <h2 className="bm-dialog-title">
          {removeTarget !== null && removeTarget.source === 'x_bookmark'
            ? 'Remove this bookmark?'
            : 'Remove this capture?'}
        </h2>
        <p className="bm-dialog-body">It leaves your knowledge base.</p>
        {removeError !== null ? <p className="bm-dialog-error">{removeError}</p> : null}
        <div className="bm-dialog-actions">
          <button type="button" className="bm-dialog-btn" onClick={closeRemove} disabled={removeBusy}>
            Cancel
          </button>
          <button
            type="button"
            className="bm-dialog-btn is-danger"
            onClick={() => void confirmRemove()}
            disabled={removeBusy}
          >
            Remove
          </button>
        </div>
      </div>
    </Modal>
  )

  if (bookmarks.length === 0 && !liveX) {
    return (
      <div className="bm">
        <header className="bm-header">
          <div>
            <h1 className="bm-title display">Bookmarks</h1>
          </div>
        </header>
        {renderCaptures()}
        <EmptyState
          icon={<BookmarkIcon size={20} />}
          title="Nothing saved yet"
          message="Your X bookmarks will appear here."
        />
        {removeDialog}
      </div>
    )
  }

  return (
    <div className="bm">
      <header className="bm-header">
        <div>
          <h1 className="bm-title display">Bookmarks</h1>
          <span className="bm-meta tnum">{savedTotal} saved</span>
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

      {renderCaptures()}
      {renderFromX()}

      {removeDialog}
    </div>
  )
}
