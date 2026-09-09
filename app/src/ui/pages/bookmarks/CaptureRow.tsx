import { Bookmark as BookmarkIcon, Camera, ChevronDown, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { KbEntry } from '../../../shared/kb'
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

/**
 * One knowledge-base entry: compact collapsed row matching the bookmark rows,
 * with the title linking straight to the captured page. The screenshot stays
 * stored for normalization but is never rendered (2026-08-26 decision).
 */
export function CaptureRow({
  entry,
  expanded,
  onToggle,
  onRetry,
  onRemoveRequest
}: CaptureRowProps): ReactNode {
  const title = captureTitle(entry)
  const host = captureHost(entry.url)
  const pending = entry.status === 'pending'
  const failed = entry.status === 'failed'
  const linkable = entry.url !== null && isSecurePostUrl(entry.url)
  const hasDetail = entry.author !== null
  const canExpand = hasDetail

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
            {linkable ? (
              <a
                className="bm-handle bm-cap-link"
                href={entry.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {title}
              </a>
            ) : (
              <span className="bm-handle">{title}</span>
            )}
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
              <span className="bm-cap-author">By {entry.author}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
