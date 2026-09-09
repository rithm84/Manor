import { AudioLines, Check, Copy, Trash2, UserRound, X } from 'lucide-react'
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
  onUpdateContext: (originalName: string, context: ContextDraft) => Promise<ContextDefinition>
  onDeleteContext: (name: string) => Promise<void>
  onDuplicate: (task: Task) => Promise<void>
  onDelete: (taskId: string) => void
}

/**
 * Centered task detail editing a local draft: nothing persists until Save
 * (enabled only once something changed) or the dialog closes, which commits
 * the same draft so an edit is never lost to clicking away. Completion is
 * not an action here; the card's checkbox owns it.
 */
export function TaskDetailDialog({
  task,
  open,
  contexts,
  dueAttention,
  onClose,
  onUpdate,
  onAddContext,
  onUpdateContext,
  onDeleteContext,
  onDuplicate,
  onDelete
}: TaskDetailDialogProps): ReactNode {
  const [draft, setDraft] = useState<Task | null>(task)

  /* Reset only when a different task opens, never on a background refresh
     replacing the same task's object identity, so in-progress edits survive
     live updates from Codex or another window. */
  const taskId = task?.id ?? null
  useEffect(() => {
    setDraft(task)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, open])

  if (task === null || draft === null) {
    return null
  }
  const provenance = provenanceFor(task)

  /** The draft with the title normalized; an emptied title keeps the old one. */
  const normalizedDraft = (): Task => {
    const trimmed = draft.title.trim()
    return { ...draft, title: trimmed === '' ? task.title : trimmed }
  }

  const dirty = JSON.stringify(normalizedDraft()) !== JSON.stringify(task)

  const saveDraft = (): void => {
    if (!dirty) return
    void onUpdate(normalizedDraft())
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  // Closing commits too; blur does not fire on unmount and an edit must
  // never be lost to clicking away.
  const closeWithSave = (): void => {
    saveDraft()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={closeWithSave}
      width={620}
      ariaLabel={`Task details for ${task.title}`}
    >
      <section className="task-detail-dialog">
        <header className="task-detail-header">
          <input
            className="peek-title-input"
            autoFocus
            value={draft.title}
            aria-label="Task title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={onTitleKeyDown}
          />
          <button
            type="button"
            className="task-detail-close"
            onClick={closeWithSave}
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
                  value={draft.status}
                  options={STATUS_OPTIONS}
                  onChange={(status) => setDraft({ ...draft, status: status as TaskStatus })}
                  placeholder="Empty"
                  ariaLabel="Status"
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Due</span>
                <DueDatePicker
                  value={draft.due}
                  onChange={(due) => setDraft({ ...draft, due })}
                  ariaLabel="Due date"
                  min={null}
                  max={null}
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Context</span>
                <ContextSelect
                  value={draft.context}
                  contexts={contexts}
                  onChange={(context) => setDraft({ ...draft, context })}
                  onAdd={onAddContext}
                  onUpdate={onUpdateContext}
                  onDelete={onDeleteContext}
                  placeholder="Empty"
                  ariaLabel="Context"
                />
              </div>
              <div className="peek-row">
                <span className="peek-label">Time needed</span>
                <Select
                  value={draft.estimateMinutes === null ? null : String(draft.estimateMinutes)}
                  options={ESTIMATE_SELECT_OPTIONS}
                  onChange={(estimate) =>
                    setDraft({
                      ...draft,
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
                  value={draft.priority}
                  options={PRIORITY_OPTIONS}
                  onChange={(priority) => setDraft({ ...draft, priority: priority as TaskPriority })}
                  placeholder="Empty"
                  ariaLabel="Priority"
                />
              </div>
              <div className="peek-row peek-row--tall">
                <span className="peek-label">Repeats</span>
                <RecurrenceEditor
                  key={task.id}
                  value={draft.recurrence}
                  onChange={(recurrence) => setDraft({ ...draft, recurrence })}
                />
              </div>
            </div>

            <div className="peek-activity">
              {provenance.byCodex ? <AudioLines size={14} /> : <UserRound size={14} />}
              <span>{provenance.line}</span>
            </div>

            <div className="peek-actions">
              <Button
                variant="primary"
                icon={<Check size={16} />}
                disabled={!dirty}
                onClick={closeWithSave}
              >
                Save changes
              </Button>
              <div className="peek-actions-side">
                <button
                  type="button"
                  className="peek-duplicate"
                  onClick={() => {
                    saveDraft()
                    void onDuplicate(normalizedDraft())
                  }}
                >
                  <Copy size={15} />
                  Duplicate
                </button>
                <button
                  type="button"
                  className="peek-delete"
                  onClick={() => onDelete(task.id)}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Modal>
  )
}
