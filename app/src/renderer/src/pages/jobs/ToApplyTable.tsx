import type { ReactNode } from 'react'

import { Button } from '../../components/ui'
import type { LocalPosting } from './jobsModel'
import { ageLabel } from './jobsModel'

export interface ToApplyTableProps {
  postings: readonly LocalPosting[]
  /** Rows currently animating out after "Mark applied". */
  leavingIds: ReadonlySet<string>
  onMarkApplied: (postingId: string) => void
  onOpenPosting: (postingId: string) => void
  /** Rows can also be dragged straight into the Applied column. */
  onDragStartPosting: (postingId: string) => void
  onDragEnd: () => void
}

/** Compact Notion-table-style rows for roles waiting on an application. */
export function ToApplyTable({
  postings,
  leavingIds,
  onMarkApplied,
  onOpenPosting,
  onDragStartPosting,
  onDragEnd
}: ToApplyTableProps): ReactNode {
  if (postings.length === 0) {
    return (
      <div className="toapply">
        <div className="toapply-empty">Nothing waiting. New roles land here each morning.</div>
      </div>
    )
  }

  return (
    <div className="toapply" role="table" aria-label="Roles to apply to">
      <div className="toapply-row toapply-head" role="row">
        <span>Company</span>
        <span>Role</span>
        <span>Location</span>
        <span>Posted</span>
        <span />
      </div>
      {postings.map((posting) => (
        <div
          key={posting.id}
          className={`toapply-item toapply-row${leavingIds.has(posting.id) ? ' is-leaving' : ''}`}
          role="row"
          draggable
          onClick={() => onOpenPosting(posting.id)}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', posting.id)
            event.dataTransfer.effectAllowed = 'move'
            onDragStartPosting(posting.id)
          }}
          onDragEnd={onDragEnd}
        >
          <span className="toapply-company">
            <span
              className={`toapply-dot${posting.ageDays === 0 ? '' : ' toapply-dot--spacer'}`}
              title={posting.ageDays === 0 ? 'New today' : undefined}
            />
            {posting.company}
          </span>
          <span className="toapply-role">{posting.role}</span>
          <span className="toapply-loc">{posting.location}</span>
          <span className="toapply-age">{ageLabel(posting.ageDays)}</span>
          <span className="toapply-action" onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" onClick={() => onMarkApplied(posting.id)}>
              Mark applied
            </Button>
          </span>
        </div>
      ))}
    </div>
  )
}
