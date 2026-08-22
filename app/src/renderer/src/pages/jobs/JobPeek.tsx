import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

import { Input, Select, SidePeek } from '../../components/ui'
import type { BoardCard, JobColumn, LocalPosting } from './jobsModel'
import { ageLabel, dateRowsFor, jobColumns } from './jobsModel'

/** Where a peeked role can be moved to. Postings can stay in To apply. */
export type StageValue = 'toapply' | JobColumn

export type PeekData =
  | { kind: 'card'; card: BoardCard }
  | { kind: 'posting'; posting: LocalPosting }

export interface JobPeekProps {
  /** The open role; null renders the closed panel. */
  data: PeekData | null
  open: boolean
  onClose: () => void
  onChangeStage: (stage: StageValue) => void
  onEditLink: (link: string) => void
  onEditNotes: (notes: string) => void
}

const cardStageOptions = jobColumns.map((meta) => ({
  value: meta.column,
  label: meta.label
}))

const postingStageOptions = [{ value: 'toapply', label: 'To apply' }, ...cardStageOptions]

function isStageValue(value: string): value is StageValue {
  return value === 'toapply' || jobColumns.some((meta) => meta.column === value)
}

/**
 * Notion-style side peek for a role: stage, the dates that stage makes
 * relevant, the posting link, and free-form notes. Edits mutate local page
 * state only.
 */
export function JobPeek({
  data,
  open,
  onClose,
  onChangeStage,
  onEditLink,
  onEditNotes
}: JobPeekProps): ReactNode {
  if (data === null) {
    return null
  }

  const company = data.kind === 'card' ? data.card.company : data.posting.company
  const role = data.kind === 'card' ? data.card.role : data.posting.role
  const link = data.kind === 'card' ? data.card.link : data.posting.link
  const notes = data.kind === 'card' ? data.card.notes : data.posting.notes
  const stageValue: StageValue = data.kind === 'card' ? data.card.column : 'toapply'

  return (
    <SidePeek open={open} onClose={onClose} title={company} width={440}>
      <div className="jpeek">
        <div className="jpeek-role">{role}</div>
        {data.kind === 'posting' && data.posting.location !== '' ? (
          <div className="jpeek-sub">{data.posting.location}</div>
        ) : null}

        <div className="jpeek-props">
          <div className="jpeek-row">
            <span className="jpeek-label">Stage</span>
            <Select
              value={stageValue}
              options={data.kind === 'card' ? cardStageOptions : postingStageOptions}
              onChange={(value) => {
                if (isStageValue(value)) {
                  onChangeStage(value)
                }
              }}
              placeholder="Empty"
              ariaLabel="Stage"
            />
          </div>

          {data.kind === 'card' ? (
            dateRowsFor(data.card).map((row) => (
              <div key={row.label} className="jpeek-row">
                <span className="jpeek-label">{row.label}</span>
                <span className={`jpeek-value${row.muted ? ' is-muted' : ''}`}>{row.value}</span>
              </div>
            ))
          ) : (
            <div className="jpeek-row">
              <span className="jpeek-label">Posted</span>
              <span className="jpeek-value">{ageLabel(data.posting.ageDays)}</span>
            </div>
          )}

          <div className="jpeek-row">
            <span className="jpeek-label">Link</span>
            <span className="jpeek-link">
              <Input
                value={link}
                onChange={onEditLink}
                placeholder="Paste the posting"
                ariaLabel="Posting link"
              />
              {link.trim() !== '' ? (
                <button
                  type="button"
                  className="jpeek-open"
                  aria-label="Open posting"
                  title="Open posting"
                >
                  <ExternalLink size={14} />
                </button>
              ) : null}
            </span>
          </div>

          <div className="jpeek-row jpeek-row--tall">
            <span className="jpeek-label">Notes</span>
            <textarea
              className="jpeek-notes"
              value={notes}
              placeholder="Anything worth remembering."
              aria-label={`Notes on ${company}`}
              onChange={(event) => onEditNotes(event.target.value)}
              rows={5}
            />
          </div>
        </div>
      </div>
    </SidePeek>
  )
}
