import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'

import { Pill } from '../../components/ui'
import type { QuickActionPoint } from '../../components/ui'
import type { ContextDefinition, Task, TaskBucketMeta } from '../../data/mock'
import { TaskCard } from './TaskCard'
import { canCreateTaskInBucket } from './taskModel'

export interface KanbanColumnProps {
  meta: TaskBucketMeta
  tasks: readonly Task[]
  contexts: readonly ContextDefinition[]
  today: string
  completingIds: ReadonlySet<string>
  onOpenComposer: (trigger: HTMLElement) => void
  onOpenTask: (taskId: string) => void
  onQuickActions: (taskId: string, point: QuickActionPoint) => void
  onToggleComplete: (taskId: string) => void
}

/**
 * One board column: filled group pill + muted count (the Notion signature),
 * faint colorway tint, cards, and a "+ New" entry point for the shared
 * creation dialog.
 */
export function KanbanColumn({
  meta,
  tasks,
  contexts,
  today,
  completingIds,
  onOpenComposer,
  onOpenTask,
  onQuickActions,
  onToggleComplete
}: KanbanColumnProps): ReactNode {
  const creatable = canCreateTaskInBucket(meta.bucket)
  const { setNodeRef, isOver } = useDroppable({
    id: `bucket:${meta.bucket}`,
    data: { type: 'bucket', targetBucket: meta.bucket }
  })

  return (
    <section
      ref={setNodeRef}
      className={`kanban-col is-${meta.colorway}${isOver ? ' is-drag-over' : ''}`}
      aria-label={meta.label}
    >
      <header className="kanban-col-head">
        <Pill variant="group" colorway={meta.colorway} label={meta.label} count={tasks.length} />
        {creatable ? (
          <button
            type="button"
            className="kanban-col-add"
            onClick={(event) => onOpenComposer(event.currentTarget)}
            aria-label={`New task in ${meta.label}`}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </header>

      <div className="kanban-cards">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            contexts={contexts}
            bucket={meta.bucket}
            today={today}
            completing={completingIds.has(task.id)}
            onOpen={onOpenTask}
            onQuickActions={onQuickActions}
            onToggleComplete={onToggleComplete}
          />
        ))}
      </div>

      {creatable ? (
        <button type="button" className="kanban-new" onClick={(event) => onOpenComposer(event.currentTarget)}>
          <Plus size={14} />
          New
        </button>
      ) : null}
    </section>
  )
}
