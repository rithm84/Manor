import { Repeat } from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'

import { Checkbox, Pill } from '../../components/ui'
import type { Task } from '../../data/mock'
import { CONTEXT_COLORWAY, PRIORITY_COLORWAY, TASK_DRAG_TYPE } from './taskModel'

export interface TaskCardProps {
  task: Task
  /** Mid-fade after its checkbox was ticked. */
  completing: boolean
  onOpen: (taskId: string) => void
  onToggleComplete: (taskId: string) => void
}

/**
 * One board card, Notion-style: checkbox + title line, then property chips.
 * Draggable onto the Today panel to block time.
 */
export function TaskCard({ task, completing, onOpen, onToggleComplete }: TaskCardProps): ReactNode {
  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
    event.dataTransfer.setData('text/plain', task.id)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      className={`task-card${completing ? ' is-completing' : ''}`}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onOpen(task.id)
        }
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
        <Pill variant="tag" colorway={CONTEXT_COLORWAY[task.context]} label={task.context} />
        {task.difficulty !== null ? (
          <Pill variant="tag" colorway="neutral" label={task.difficulty} />
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
        {task.bucket === 'overdue' && task.daysLate > 0 ? (
          <span className="task-card-late tnum">
            {task.daysLate === 1 ? '1 day late' : `${task.daysLate} days late`}
          </span>
        ) : null}
      </div>
    </div>
  )
}
