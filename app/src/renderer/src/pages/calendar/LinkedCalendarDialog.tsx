import { BriefcaseBusiness, CheckSquare2, TimerReset } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ScratchBlock, Task } from '../../../../shared/home'
import type { JobRole } from '../../../../shared/jobs'
import { Button, DetailDialog } from '../../components/ui'
import type { CalendarItemReference } from './calendarEvents'

export interface LinkedCalendarDialogProps {
  reference: CalendarItemReference | null
  tasks: readonly Task[]
  blocks: readonly ScratchBlock[]
  roles: readonly JobRole[]
  onClose: () => void
  onOpenModule: (module: 'home' | 'jobs') => void
}

export function LinkedCalendarDialog({
  reference,
  tasks,
  blocks,
  roles,
  onClose,
  onOpenModule
}: LinkedCalendarDialogProps): ReactNode {
  if (reference === null || reference.kind === 'event') return null
  const task = reference.kind === 'task' ? tasks.find((item) => item.id === reference.sourceId) ?? null : null
  const block = reference.kind === 'scratch' ? blocks.find((item) => item.id === reference.sourceId) ?? null : null
  const blockTask = block === null ? null : tasks.find((item) => item.id === block.taskId) ?? null
  const role = reference.kind === 'job' ? roles.find((item) => item.id === reference.sourceId) ?? null : null
  const title = task?.title ?? blockTask?.title ?? (role === null ? 'Linked item' : `${role.company} · ${role.role}`)

  return (
    <DetailDialog open onClose={onClose} title={title} width={560} ariaLabel={`${title} calendar summary`}>
      <div className="cal-linked-summary">
        {task !== null ? (
          <><CheckSquare2 size={18} /><dl><div><dt>Due</dt><dd>{task.due}</dd></div><div><dt>Status</dt><dd>{task.status}</dd></div><div><dt>Context</dt><dd>{task.context}</dd></div></dl></>
        ) : null}
        {block !== null ? (
          <><TimerReset size={18} /><dl><div><dt>Date</dt><dd>{block.date}</dd></div><div><dt>Time</dt><dd>{block.start} to {block.end}</dd></div><div><dt>Portion</dt><dd>{block.portion}</dd></div></dl></>
        ) : null}
        {role !== null ? (
          <><BriefcaseBusiness size={18} /><dl><div><dt>Stage</dt><dd>{role.stage.replaceAll('_', ' ')}</dd></div><div><dt>Location</dt><dd>{role.location || 'Not set'}</dd></div></dl></>
        ) : null}
        <div className="cal-linked-actions">
          <Button variant="primary" onClick={() => onOpenModule(role === null ? 'home' : 'jobs')}>Open in {role === null ? 'Home' : 'Jobs'}</Button>
        </div>
      </div>
    </DetailDialog>
  )
}
