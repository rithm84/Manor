import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button, Input, Pill, Select } from '../../components/ui'
import type { Task, TaskBucketMeta, TaskContext, TaskDifficulty, TaskPriority } from '../../data/mock'
import { TaskCard } from './TaskCard'
import { CONTEXT_OPTIONS, DIFFICULTY_OPTIONS, PRIORITY_OPTIONS } from './taskModel'

/** Values collected by the inline composer before a task exists. */
export interface DraftTask {
  title: string
  context: TaskContext
  difficulty: TaskDifficulty | null
  priority: TaskPriority | null
}

export interface KanbanColumnProps {
  meta: TaskBucketMeta
  tasks: readonly Task[]
  completingIds: ReadonlySet<string>
  composerOpen: boolean
  onOpenComposer: () => void
  onCloseComposer: () => void
  onCreate: (draft: DraftTask) => void
  onOpenTask: (taskId: string) => void
  onToggleComplete: (taskId: string) => void
}

interface ComposerState {
  title: string
  context: TaskContext
  difficulty: TaskDifficulty | null
  priority: TaskPriority | null
}

const EMPTY_COMPOSER: ComposerState = {
  title: '',
  context: 'Personal',
  difficulty: null,
  priority: null
}

/**
 * One board column: filled group pill + muted count (the Notion signature),
 * faint colorway tint, cards, and a "+ New" ghost row that becomes an inline
 * card composer with quick property chips.
 */
export function KanbanColumn({
  meta,
  tasks,
  completingIds,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onCreate,
  onOpenTask,
  onToggleComplete
}: KanbanColumnProps): ReactNode {
  const [draft, setDraft] = useState<ComposerState>(EMPTY_COMPOSER)

  const submit = (): void => {
    const title = draft.title.trim()
    if (title === '') {
      return
    }
    onCreate({
      title,
      context: draft.context,
      difficulty: draft.difficulty,
      priority: draft.priority
    })
    setDraft(EMPTY_COMPOSER)
  }

  const cancel = (): void => {
    setDraft(EMPTY_COMPOSER)
    onCloseComposer()
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      submit()
    }
    if (event.key === 'Escape') {
      cancel()
    }
  }

  return (
    <section className={`kanban-col is-${meta.colorway}`} aria-label={meta.label}>
      <header className="kanban-col-head">
        <Pill variant="group" colorway={meta.colorway} label={meta.label} count={tasks.length} />
        <button
          type="button"
          className="kanban-col-add"
          onClick={onOpenComposer}
          aria-label={`New task in ${meta.label}`}
        >
          <Plus size={14} />
        </button>
      </header>

      <div className="kanban-cards">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            completing={completingIds.has(task.id)}
            onOpen={onOpenTask}
            onToggleComplete={onToggleComplete}
          />
        ))}

        {composerOpen ? (
          <div className="task-composer" onKeyDown={onComposerKeyDown}>
            <Input
              value={draft.title}
              onChange={(title) => setDraft({ ...draft, title })}
              placeholder="Task name"
              ariaLabel={`New task in ${meta.label}`}
              autoFocus
            />
            <div className="task-composer-props">
              <Select
                value={draft.context}
                options={CONTEXT_OPTIONS}
                onChange={(value) => setDraft({ ...draft, context: value as TaskContext })}
                placeholder="Context"
                ariaLabel="Context"
              />
              <Select
                value={draft.difficulty}
                options={DIFFICULTY_OPTIONS}
                onChange={(value) => setDraft({ ...draft, difficulty: value as TaskDifficulty })}
                placeholder="Time"
                ariaLabel="Difficulty"
              />
              <Select
                value={draft.priority}
                options={PRIORITY_OPTIONS}
                onChange={(value) => setDraft({ ...draft, priority: value as TaskPriority })}
                placeholder="Priority"
                ariaLabel="Priority"
              />
            </div>
            <div className="task-composer-actions">
              <Button variant="primary" onClick={submit} disabled={draft.title.trim() === ''}>
                Add
              </Button>
              <Button variant="subtle" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="kanban-new" onClick={onOpenComposer}>
            <Plus size={14} />
            New
          </button>
        )}
      </div>
    </section>
  )
}
