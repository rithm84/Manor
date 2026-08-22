import { Activity, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { EmptyState } from '../components/ui'
import { alfredAudit } from '../data/mock'
import type { AlfredAuditEntry } from '../data/mock'
import { PageShell } from './PageShell'
import './alfred-activity.css'

interface AuditRow {
  id: string
  action: string
  target: string
  whenLabel: string
  /** Recent rows can still be undone. */
  undoable: boolean
}

/** Split an audit line like "Created task 'two-pointers set'" into action + target. */
const toRow = (entry: AlfredAuditEntry, index: number): AuditRow => {
  const quoted = entry.action.match(/^(.*?)\s+'(.+)'$/)
  if (quoted !== null) {
    return {
      id: entry.id,
      action: quoted[1],
      target: quoted[2],
      whenLabel: entry.whenLabel,
      undoable: index === 0
    }
  }
  const firstSpace = entry.action.indexOf(' ')
  return {
    id: entry.id,
    action: firstSpace === -1 ? entry.action : entry.action.slice(0, firstSpace),
    target: firstSpace === -1 ? '' : entry.action.slice(firstSpace + 1),
    whenLabel: entry.whenLabel,
    undoable: index === 0
  }
}

/** The audit trail: everything Alfred has done, newest first. */
export function AlfredActivityPage(): ReactNode {
  const [rows, setRows] = useState<readonly AuditRow[]>(alfredAudit.map(toRow))

  const undo = (id: string): void => {
    setRows(rows.filter((row) => row.id !== id))
  }

  return (
    <PageShell title="Alfred activity" fullBleed={false}>
      <p className="aa-lede">Everything Alfred does on your behalf, on the record.</p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Activity size={20} />}
          title="A clean slate"
          message="Everything Alfred does for you is recorded here."
        />
      ) : (
        <div className="aa-table" role="table" aria-label="Alfred activity">
          <div className="aa-row aa-row--head" role="row">
            <span role="columnheader">Action</span>
            <span role="columnheader">Target</span>
            <span role="columnheader" className="aa-when">
              When
            </span>
            <span aria-hidden="true" />
          </div>
          {rows.map((row) => (
            <div key={row.id} className="aa-row" role="row">
              <span role="cell" className="aa-action">
                {row.action}
              </span>
              <span role="cell" className="aa-target">
                {row.target}
              </span>
              <span role="cell" className="aa-when tnum">
                {row.whenLabel}
              </span>
              <span role="cell" className="aa-undo-cell">
                {row.undoable ? (
                  <button type="button" className="aa-undo" onClick={() => undo(row.id)}>
                    <Undo2 size={13} />
                    Undo
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
