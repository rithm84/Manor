import { ChevronDown, ExternalLink, FileText } from 'lucide-react'
import type { ReactNode } from 'react'

import { Pill } from '../../components/ui'
import type { Bookmark } from '../../data/mock'

export interface BookmarkRowProps {
  bookmark: Bookmark
  /** One-line gist of the captured article; null when none was captured. */
  articleSummary: string | null
  expanded: boolean
  onToggle: () => void
}

/** Only https posts get an external-open link; anything else renders none. */
export function isSecurePostUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function timeLabel(savedAt: string): string {
  const date = new Date(savedAt)
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const meridiem = hours >= 12 ? 'PM' : 'AM'
  const clockHours = hours % 12 === 0 ? 12 : hours % 12
  return `${clockHours}:${minutes} ${meridiem}`
}

/** One saved post: compact collapsed row, inline expansion on click. */
export function BookmarkRow({
  bookmark,
  articleSummary,
  expanded,
  onToggle
}: BookmarkRowProps): ReactNode {
  const initial = bookmark.authorName.charAt(0).toUpperCase()
  const hasArticle = bookmark.linkedArticleTitle !== null

  return (
    <div className={`bm-row${expanded ? ' is-expanded' : ''}`}>
      <div
        className="bm-row-main"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
      >
        <span className="bm-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="bm-body">
          <span className="bm-byline">
            <span className="bm-handle">{bookmark.authorHandle}</span>
            <span className="bm-name">{bookmark.authorName}</span>
          </span>
          <span className="bm-text">{bookmark.text}</span>
          {hasArticle && !expanded ? (
            <span className="bm-tags">
              <Pill variant="tag" colorway="neutral" label="Article" />
            </span>
          ) : null}
        </span>
        <span className="bm-side">
          <span className="bm-time">{timeLabel(bookmark.savedAt)}</span>
          {isSecurePostUrl(bookmark.postUrl) ? (
            <a
              className="bm-open"
              href={bookmark.postUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${bookmark.authorHandle} on X`}
              title="Open on X"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          ) : null}
          <ChevronDown size={14} className="bm-caret" />
        </span>
      </div>
      {hasArticle ? (
        <div className="bm-expand" aria-hidden={!expanded}>
          <div className="bm-expand-inner">
            <div className="bm-article">
              <FileText size={16} className="bm-article-icon" />
              <span>
                <span className="bm-article-title">{bookmark.linkedArticleTitle}</span>
                {articleSummary !== null ? (
                  <span className="bm-article-summary">{articleSummary}</span>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
