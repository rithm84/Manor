import { Repeat } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'

import { Checkbox, Pill, useClickIntent } from '../../components/ui'
import type { QuickActionPoint } from '../../components/ui'
import type { ContextDefinition, Task, TaskBucket } from '../../data/mock'
import { ContextPill } from './ContextPill'
import {
  ESTIMATE_COLORWAY,
  PRIORITY_COLORWAY,
  daysLate,
  estimateLabel
} from './taskModel'

export interface TaskCardProps {
  task: Task
  contexts: readonly ContextDefinition[]
  bucket: TaskBucket | null
  today: string
  /** Mid-fade after its checkbox was ticked. */
  completing: boolean
  onOpen: (taskId: string) => void
  onQuickActions: (taskId: string, point: QuickActionPoint) => void
  onToggleComplete: (taskId: string) => void
}

export function TaskCardPreview({
  task,
  contexts
}: {
  task: Task
  contexts: readonly ContextDefinition[]
}): ReactNode {
  return (
    <div className="task-card task-drag-card" aria-hidden="true">
      <div className="task-card-top">
        <span className="task-drag-checkbox" />
        <span className="task-card-title">{task.title}</span>
      </div>
      <div className="task-card-chips">
        <ContextPill name={task.context} contexts={contexts} />
        {task.estimateMinutes !== null ? (
          <Pill
            variant="tag"
            colorway={ESTIMATE_COLORWAY[task.estimateMinutes]}
            label={estimateLabel(task.estimateMinutes)}
          />
        ) : null}
        {task.priority !== null ? <Pill variant="tag" colorway={PRIORITY_COLORWAY[task.priority]} label={task.priority} /> : null}
      </div>
    </div>
  )
}

/**
 * One board card, Notion-style: checkbox + title line, then property chips.
 * Draggable onto the Today panel to block time.
 */
export function TaskCard({
  task,
  contexts,
  bucket,
  today,
  completing,
  onOpen,
  onQuickActions,
  onToggleComplete
}: TaskCardProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task:${task.id}`,
    data: { type: 'task', taskId: task.id, sourceBucket: bucket }
  })
  const late = daysLate(task, today)
  const clickIntent = useClickIntent<HTMLDivElement>(
    () => onOpen(task.id),
    (point) => onQuickActions(task.id, point),
    isDragging
  )

  return (
    <div
      className={`task-card${completing ? ' is-completing' : ''}${isDragging ? ' is-dragging' : ''}`}
      ref={setNodeRef}
      style={{ transform: isDragging ? undefined : CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      onClick={clickIntent.onClick}
      onContextMenu={clickIntent.onContextMenu}
      onKeyDown={(event) => {
        clickIntent.onKeyDown(event)
        if (event.defaultPrevented) return
        if (event.key === 'Enter') {
          event.preventDefault()
          clickIntent.openNow()
          return
        }
        listeners?.onKeyDown?.(event)
      }}
    >
      <div className="task-card-top">
        <span
          className="task-card-check"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            shape="square"
            checked={completing || task.status === 'Done'}
            onChange={() => onToggleComplete(task.id)}
            ariaLabel={`Complete ${task.title}`}
          />
        </span>
        <span className="task-card-title">{task.title}</span>
      </div>
      <div className="task-card-chips">
        <ContextPill name={task.context} contexts={contexts} />
        {task.estimateMinutes !== null ? (
          <Pill
            variant="tag"
            colorway={ESTIMATE_COLORWAY[task.estimateMinutes]}
            label={estimateLabel(task.estimateMinutes)}
          />
        ) : null}
        {task.priority !== null ? (
          <Pill variant="tag" colorway={PRIORITY_COLORWAY[task.priority]} label={task.priority} />
        ) : null}
        {task.tags.map((tag) => (
          <Pill key={tag} variant="tag" colorway="tomorrow" label={tag} />
        ))}
        {task.recurrence !== null ? (
          <span className="task-card-recur" title={task.recurrence} aria-label={`Repeats: ${task.recurrence}`}>
            <Repeat size={12} />
          </span>
        ) : null}
        {bucket === 'overdue' && late > 0 ? (
          <span className="task-card-late tnum">
            {late === 1 ? '1 day late' : `${late} days late`}
          </span>
        ) : null}
      </div>
    </div>
  )
}
