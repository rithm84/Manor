import { AudioLines, Check, Clock3, Trash2, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, Select, SidePeek } from '../../components/ui'
import type { Task, TaskContext, TaskDifficulty, TaskPriority, TaskStatus } from '../../data/mock'
import { DueDatePicker } from './DueDatePicker'
import { RecurrenceEditor } from './RecurrenceEditor'
import {
  CONTEXT_OPTIONS,
  DIFFICULTY_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  formatClock,
  formatDayLabel,
  provenanceFor,
  withDue
} from './taskModel'

export interface TaskPeekProps {
  /** The open task; null renders the closed panel. */
  task: Task | null
  open: boolean
  onClose: () => void
  onUpdate: (task: Task) => void
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
}

/**
 * Notion-style side peek for a task: full property stack, time blocks,
 * provenance line, and complete/delete actions. Edits mutate local page
 * state only.
 */
export function TaskPeek({ task, open, onClose, onUpdate, onComplete, onDelete }: TaskPeekProps): ReactNode {
  if (task === null) {
    return null
  }
  const provenance = provenanceFor(task)

  return (
    <SidePeek open={open} onClose={onClose} title={task.title} width={460}>
      <div className="peek">
        <div className="peek-props">
          <div className="peek-row">
            <span className="peek-label">Status</span>
            <Select
              value={task.status}
              options={STATUS_OPTIONS}
              onChange={(status) => onUpdate({ ...task, status: status as TaskStatus })}
              placeholder="Empty"
              ariaLabel="Status"
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Due</span>
            <DueDatePicker
              value={task.due}
              onChange={(due) => onUpdate(withDue(task, due))}
              ariaLabel="Due date"
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Context</span>
            <Select
              value={task.context}
              options={CONTEXT_OPTIONS}
              onChange={(context) => onUpdate({ ...task, context: context as TaskContext })}
              placeholder="Empty"
              ariaLabel="Context"
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Time needed</span>
            <Select
              value={task.difficulty}
              options={DIFFICULTY_OPTIONS}
              onChange={(difficulty) =>
                onUpdate({ ...task, difficulty: difficulty as TaskDifficulty })
              }
              placeholder="Empty"
              ariaLabel="Time needed"
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Priority</span>
            <Select
              value={task.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority) => onUpdate({ ...task, priority: priority as TaskPriority })}
              placeholder="Empty"
              ariaLabel="Priority"
            />
          </div>
          <div className="peek-row peek-row--tall">
            <span className="peek-label">Repeats</span>
            <RecurrenceEditor
              key={task.id}
              value={task.recurrence}
              onChange={(recurrence) => onUpdate({ ...task, recurrence })}
            />
          </div>
        </div>

        <div className="peek-section">
          <span className="peek-section-title">Time blocks</span>
          {task.timeBlocks.length > 0 ? (
            <div className="peek-blocks">
              {task.timeBlocks.map((block) => (
                <div key={`${block.date}-${block.start}`} className="peek-block">
                  <Clock3 size={14} />
                  <span className="tnum">
                    {formatDayLabel(block.date)} · {formatClock(block.start)} to{' '}
                    {formatClock(block.end)}
                  </span>
                  <span className="peek-block-portion">{block.portion}</span>
                </div>
              ))}
            </div>
          ) : (
            <span className="peek-blocks-empty">No time set aside yet.</span>
          )}
        </div>

        <div className="peek-activity">
          {provenance.byAlfred ? <AudioLines size={14} /> : <UserRound size={14} />}
          <span>{provenance.line}</span>
        </div>

        <div className="peek-actions">
          <Button variant="primary" icon={<Check size={16} />} onClick={() => onComplete(task.id)}>
            Mark complete
          </Button>
          <button type="button" className="peek-delete" onClick={() => onDelete(task.id)}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
      </div>
    </SidePeek>
  )
}
