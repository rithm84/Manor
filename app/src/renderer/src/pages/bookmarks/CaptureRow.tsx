import { Bookmark as BookmarkIcon, Camera, ChevronDown, ExternalLink, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { KbEntry } from '../../../../shared/kb'
import { isSecurePostUrl } from './BookmarkRow'
import { captureHost, captureTimeLabel, captureTitle } from './captures'

export interface CaptureRowProps {
  entry: KbEntry
  expanded: boolean
  onToggle: () => void
  /** Re-runs normalization for a failed entry. */
  onRetry: () => void
  /** Opens the remove confirmation for this entry. */
  onRemoveRequest: () => void
}

type ScreenshotState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'failed' }

/**
 * One knowledge-base entry: compact collapsed row matching the bookmark rows,
 * inline expansion with author, summary, and a lazily signed screenshot.
 */
export function CaptureRow({
  entry,
  expanded,
  onToggle,
  onRetry,
  onRemoveRequest
}: CaptureRowProps): ReactNode {
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ kind: 'idle' })

  // Signed URLs are short-lived, so fetch on each expand and reset on collapse.
  useEffect(() => {
    if (!expanded || entry.screenshotPath === null) {
      setScreenshot({ kind: 'idle' })
      return
    }
    let cancelled = false
    setScreenshot({ kind: 'loading' })
    window.manor.kb.screenshotUrl(entry.id).then(
      (url) => {
        if (cancelled) return
        setScreenshot(url === null ? { kind: 'failed' } : { kind: 'ready', url })
      },
      () => {
        if (cancelled) return
        setScreenshot({ kind: 'failed' })
      }
    )
    return (): void => {
      cancelled = true
    }
  }, [expanded, entry.id, entry.screenshotPath])

  const title = captureTitle(entry)
  const host = captureHost(entry.url)
  const pending = entry.status === 'pending'
  const failed = entry.status === 'failed'
  const hasDetail = entry.author !== null || entry.screenshotPath !== null
  const canExpand = hasDetail || entry.summary !== null

  return (
    <div className={`bm-row bm-cap${expanded ? ' is-expanded' : ''}${failed ? ' is-failed' : ''}`}>
      <div
        className="bm-row-main"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => {
          if (canExpand) onToggle()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (canExpand) onToggle()
          }
        }}
      >
        <span className="bm-avatar bm-cap-avatar" aria-hidden="true">
          {entry.source === 'capture' ? <Camera size={14} /> : <BookmarkIcon size={14} />}
        </span>
        <span className="bm-body">
          <span className="bm-byline">
            <span className="bm-handle">{title}</span>
            {host !== null && host !== title ? <span className="bm-name">{host}</span> : null}
          </span>
          {pending ? (
            <span className="bm-text bm-cap-saving">Saving…</span>
          ) : failed ? (
            <span className="bm-text bm-cap-error">
              {entry.error !== null ? entry.error : 'This capture did not save.'}
            </span>
          ) : entry.summary !== null ? (
            <span className="bm-text">{entry.summary}</span>
          ) : null}
        </span>
        <span className="bm-side">
          {failed ? (
            <button
              type="button"
              className="bm-cap-retry"
              onClick={(event) => {
                event.stopPropagation()
                onRetry()
              }}
            >
              Try again
            </button>
          ) : null}
          <span className="bm-time">{captureTimeLabel(entry.capturedAt, new Date())}</span>
          {entry.url !== null && isSecurePostUrl(entry.url) ? (
            <a
              className="bm-open"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${host ?? 'the source page'}`}
              title="Open source page"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          ) : null}
          <button
            type="button"
            className="bm-open bm-cap-remove"
            aria-label="Remove capture"
            title="Remove"
            onClick={(event) => {
              event.stopPropagation()
              onRemoveRequest()
            }}
          >
            <Trash2 size={14} />
          </button>
          {canExpand ? <ChevronDown size={14} className="bm-caret" /> : null}
        </span>
      </div>
      {hasDetail ? (
        <div className="bm-expand" aria-hidden={!expanded}>
          <div className="bm-expand-inner">
            <div className="bm-cap-detail">
              {entry.author !== null ? <span className="bm-cap-author">By {entry.author}</span> : null}
              {entry.screenshotPath !== null ? (
                screenshot.kind === 'ready' ? (
                  <img
                    className="bm-cap-shot"
                    src={screenshot.url}
                    alt={`Screenshot of ${title}`}
                    onError={() => setScreenshot({ kind: 'failed' })}
                  />
                ) : screenshot.kind === 'failed' ? (
                  <span className="bm-cap-shot-note">The screenshot did not load.</span>
                ) : (
                  <span className="bm-cap-shot-loading" aria-hidden="true" />
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
