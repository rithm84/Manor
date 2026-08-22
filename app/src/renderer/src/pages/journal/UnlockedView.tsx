import { Lock, PenLine } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, Tooltip } from '../../components/ui'
import { journal } from '../../data/mock'
import type { JournalEntry } from './journalEntries'

export interface UnlockedViewProps {
  entries: readonly JournalEntry[]
  selectedId: string | null
  onSelect: (entryId: string) => void
  onEdit: (entryId: string, text: string) => void
  onNewEntry: () => void
  onLock: () => void
}

function snippet(entry: JournalEntry): string {
  if (entry.text.trim() === '') {
    return 'Nothing yet'
  }
  return entry.text
}

/** Unlocked journal: dated entries on the left, a serif writing pane on the right. */
export function UnlockedView({
  entries,
  selectedId,
  onSelect,
  onEdit,
  onNewEntry,
  onLock
}: UnlockedViewProps): ReactNode {
  const selected = entries.find((entry) => entry.id === selectedId) ?? null
  const earlier = journal.entryCount - entries.length

  return (
    <div className="journal-open">
      <div className="jlist">
        <div className="jlist-head">
          <span className="jlist-head-label">Journal</span>
          <Tooltip label="New entry" side="bottom">
            <button type="button" className="jicon-btn" aria-label="New entry" onClick={onNewEntry}>
              <PenLine size={15} />
            </button>
          </Tooltip>
        </div>
        <div className="jlist-scroll">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`jlist-row${entry.id === selectedId ? ' is-selected' : ''}`}
              onClick={() => onSelect(entry.id)}
            >
              <span className="jlist-row-date">{entry.dateShort}</span>
              <span className="jlist-row-snippet">{snippet(entry)}</span>
            </button>
          ))}
          {earlier > 0 ? <div className="jlist-earlier">{earlier} earlier entries</div> : null}
        </div>
      </div>
      <div className="jwrite">
        <div className="jwrite-top">
          <Button variant="subtle" icon={<Lock size={15} />} onClick={onLock}>
            Lock
          </Button>
        </div>
        {selected !== null ? (
          <div className="jwrite-scroll">
            <div className="jwrite-inner">
              <h2 className="jwrite-date">{selected.dateLong}</h2>
              <textarea
                className="jwrite-body"
                value={selected.text}
                placeholder="Write it down."
                aria-label={`Journal entry for ${selected.dateLong}`}
                onChange={(event) => onEdit(selected.id, event.target.value)}
                autoFocus={selected.text === ''}
              />
            </div>
          </div>
        ) : (
          <div className="jwrite-empty">Pick a day, or start today's entry.</div>
        )}
      </div>
    </div>
  )
}
