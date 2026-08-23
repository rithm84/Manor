import type { ReactNode } from 'react'

import type { JobRole } from '../../../../shared/jobs'
import { Button } from '../../components/ui'
import { postedLabel } from './jobsModel'

export interface ToApplyTableProps {
  roles: readonly JobRole[]
  today: string
  /** Rows currently animating out after "Mark applied". */
  leavingIds: ReadonlySet<string>
  onMarkApplied: (roleId: string) => void
  onOpenRole: (roleId: string) => void
  /** Rows can also be dragged straight into the Applied column. */
  onDragStartRole: (roleId: string) => void
  onDragEnd: () => void
}

/** Compact Notion-table-style rows for roles waiting on an application. */
export function ToApplyTable({
  roles,
  today,
  leavingIds,
  onMarkApplied,
  onOpenRole,
  onDragStartRole,
  onDragEnd
}: ToApplyTableProps): ReactNode {
  if (roles.length === 0) {
    return (
      <div className="toapply">
        <div className="toapply-empty">No roles to apply to.</div>
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
      {roles.map((role) => (
        <div
          key={role.id}
          className={`toapply-item toapply-row${leavingIds.has(role.id) ? ' is-leaving' : ''}`}
          role="row"
          draggable
          onClick={() => onOpenRole(role.id)}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', role.id)
            event.dataTransfer.effectAllowed = 'move'
            onDragStartRole(role.id)
          }}
          onDragEnd={onDragEnd}
        >
          <span className="toapply-company">
            <span
              className={`toapply-dot${role.datePosted === today ? '' : ' toapply-dot--spacer'}`}
              title={role.datePosted === today ? 'New today' : undefined}
            />
            {role.company}
          </span>
          <span className="toapply-role">{role.role}</span>
          <span className="toapply-loc">{role.location === '' ? 'Not set' : role.location}</span>
          <span className="toapply-age">{postedLabel(role.datePosted, today)}</span>
          <span className="toapply-action" onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" onClick={() => onMarkApplied(role.id)}>
              Mark applied
            </Button>
          </span>
        </div>
      ))}
    </div>
  )
}
