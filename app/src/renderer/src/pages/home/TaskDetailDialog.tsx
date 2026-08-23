import { AudioLines, Check, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button, Modal, Select } from '../../components/ui'
import type {
  ContextDefinition,
  ContextDraft,
  Task,
  TaskEstimateMinutes,
  TaskPriority,
  TaskStatus
} from '../../data/mock'
import { ContextSelect } from './ContextSelect'
import { DueDatePicker } from './DueDatePicker'
import { RecurrenceEditor } from './RecurrenceEditor'
import {
  ESTIMATE_SELECT_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  provenanceFor
} from './taskModel'
import './homeDetails.css'

export interface TaskDetailDialogProps {
  /** The open task; null renders the closed dialog. */
  task: Task | null
  open: boolean
  contexts: readonly ContextDefinition[]
  dueAttention: boolean
  onClose: () => void
  onUpdate: (task: Task) => Promise<void>
  onAddContext: (context: ContextDraft) => Promise<ContextDefinition>
  onComplete: (taskId: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}

/**
 * Centered task detail with one directly editable title, full property stack,
 * provenance, and persisted complete/delete actions.
 */
export function TaskDetailDialog({
  task,
  open,
  contexts,
  dueAttention,
  onClose,
  onUpdate,
  onAddContext,
  onComplete,
  onDelete
}: TaskDetailDialogProps): ReactNode {
  const [title, setTitle] = useState(task?.title ?? '')

  useEffect(() => {
    setTitle(task?.title ?? '')
  }, [task?.id, task?.title])

  if (task === null) {
    return null
  }
  const provenance = provenanceFor(task)

  const saveTitle = (): void => {
    const trimmed = title.trim()
    if (trimmed === '') {
      setTitle(task.title)
      return
    }
    if (trimmed !== task.title) {
      void onUpdate({ ...task, title: trimmed })
    }
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={620}
      ariaLabel={`Task details for ${task.title}`}
    >
      <section className="task-detail-dialog">
        <header className="task-detail-header">
          <input
            className="peek-title-input"
            autoFocus
            value={title}
            aria-label="Task title"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={onTitleKeyDown}
          />
          <button
            type="button"
            className="task-detail-close"
            onClick={onClose}
            aria-label="Close task details"
          >
            <X size={16} />
          </button>
        </header>
        <div className="task-detail-body">
          <div className="peek">
            {dueAttention ? (
              <div className="peek-attention">Choose the exact day. This Week is a range.</div>
            ) : null}
            <div className="peek-props">
              <div className="peek-row">
                <span className="peek-label">Status</span>
                <Select
                  value={task.status}
                  options={STATUS_OPTIONS}
                  onChange={(status) =>
                    void onUpdate({ ...task, status: status as TaskStatus })
                  }
                  placeholder="Empty"
                  ariaLabel="Status"
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Due</span>
                <DueDatePicker
                  value={task.due}
                  onChange={(due) => void onUpdate({ ...task, due })}
                  ariaLabel="Due date"
                  min={null}
                  max={null}
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Context</span>
                <ContextSelect
                  value={task.context}
                  contexts={contexts}
                  onChange={(context) => void onUpdate({ ...task, context })}
                  onAdd={onAddContext}
                  placeholder="Empty"
                  ariaLabel="Context"
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Time needed</span>
                <Select
                  value={task.estimateMinutes === null ? null : String(task.estimateMinutes)}
                  options={ESTIMATE_SELECT_OPTIONS}
                  onChange={(estimate) =>
                    void onUpdate({
                      ...task,
                      estimateMinutes: Number(estimate) as TaskEstimateMinutes
                    })
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
                  onChange={(priority) =>
                    void onUpdate({ ...task, priority: priority as TaskPriority })
                  }
                  placeholder="Empty"
                  ariaLabel="Priority"
                />
              </div>
              <div className="peek-row peek-row--tall">
                <span className="peek-label">Repeats</span>
                <RecurrenceEditor
                  key={task.id}
                  value={task.recurrence}
                  onChange={(recurrence) => void onUpdate({ ...task, recurrence })}
                />
              </div>
            </div>

            <div className="peek-activity">
              {provenance.byAlfred ? <AudioLines size={14} /> : <UserRound size={14} />}
              <span>{provenance.line}</span>
            </div>

            <div className="peek-actions">
              <Button
                variant="primary"
                icon={<Check size={16} />}
                onClick={() => void onComplete(task.id)}
              >
                Mark complete
              </Button>
              <button
                type="button"
                className="peek-delete"
                onClick={() => void onDelete(task.id)}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </div>
        </div>
      </section>
    </Modal>
  )
}
