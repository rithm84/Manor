import { CalendarDays, Check, ChevronDown, Clock3, Copy, Flag, Layers3, Repeat2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { recurrenceLabel } from '../../../shared/recurrence'
import { ContextSelect } from './ContextSelect'
import { DueDatePicker } from './DueDatePicker'
import { RecurrenceEditor } from './RecurrenceEditor'
import { useEnterAction } from './enterAction'
import {
  ESTIMATE_SELECT_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS
} from './taskModel'
import './homeDetails.css'
import './taskDialogs.css'

export interface TaskDetailDialogProps {
  /** The open task; null renders the closed dialog. */
  task: Task | null
  open: boolean
  contexts: readonly ContextDefinition[]
  dueAttention: boolean
  today?: string
  onClose: () => void
  onUpdate: (task: Task) => Promise<void>
  onAddContext: (context: ContextDraft) => Promise<ContextDefinition>
  onUpdateContext: (
    originalName: string,
    context: ContextDraft
  ) => Promise<{ context: ContextDefinition; tasks: readonly Task[] }>
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
  today,
  onClose,
  onUpdate,
  onAddContext,
  onUpdateContext,
  onDeleteContext,
  onDuplicate,
  onDelete
}: TaskDetailDialogProps): ReactNode {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Task | null>(task)
  const [savedTask, setSavedTask] = useState<Task | null>(task)
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const panel = useRef<HTMLElement>(null)

  /* Reset only when a different task opens, never on a background refresh
     replacing the same task's object identity, so in-progress edits survive
     live updates from Codex or another window. */
  const taskId = task?.id ?? null
  useEffect(() => {
    setDraft(task)
    setSavedTask(task)
    setSaveError(null)
    setRecurrenceOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, open])

  if (task === null || draft === null) {
    return null
  }

  /** The draft with surrounding title whitespace removed. */
  const normalizedDraft = (): Task => {
    return { ...draft, title: draft.title.trim() }
  }

  const dirty = savedTask !== null && JSON.stringify(normalizedDraft()) !== JSON.stringify(savedTask)

  const saveDraft = async (): Promise<void> => {
    if (normalizedDraft().title === '') throw new Error('Enter a task title')
    if (dirty) await onUpdate(normalizedDraft())
  }

  const updateContextDefinition = async (
    originalName: string,
    context: ContextDraft
  ): Promise<ContextDefinition> => {
    const result = await onUpdateContext(originalName, context)
    const refreshedTask = result.tasks.find((candidate) => candidate.id === draft.id)
    if (refreshedTask === undefined) {
      throw new Error(`Task ${draft.id} was not returned after updating Context`)
    }
    const baselineAfterMutation = savedTask === null ? null : {
      ...savedTask,
      context: refreshedTask.context,
      revision: refreshedTask.revision
    }
    if (baselineAfterMutation === null || JSON.stringify(baselineAfterMutation) !== JSON.stringify(refreshedTask)) {
      throw new Error('This task changed while its Context was being updated. Close and reopen it before saving.')
    }
    setSavedTask(baselineAfterMutation)
    setDraft((current) => current === null ? null : {
      ...current,
      context: current.context === originalName ? result.context.name : current.context,
      revision: refreshedTask.revision
    })
    return result.context
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') closeWithSave()
  }

  // Closing commits too; blur does not fire on unmount and an edit must
  // never be lost to clicking away.
  const closeWithSave = (): void => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    void saveDraft().then(onClose).catch((error: Error) => setSaveError(error.message)).finally(() => setSaving(false))
  }


  // Enter on the panel or a closed picker saves and closes, the same as the title field.
  useEnterAction(panel, open, closeWithSave)

  return (
    <Modal
      open={open}
      onClose={closeWithSave}
      width={520}
      ariaLabel={`Task details for ${task.title}`}
    >
      <section ref={panel} className="task-dialog" data-testid="task-detail-dialog">
        <header className="task-dialog-header">
          <h2>Task</h2>
          <button type="button" className="task-dialog-close" onClick={closeWithSave} aria-label="Close task details">
            <X size={16} />
          </button>
        </header>
        <div className="task-dialog-title">
          <input
            autoFocus
            value={draft.title}
            aria-label="Task title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={onTitleKeyDown}
          />
        </div>
        <div className="task-dialog-body">
            {dueAttention ? (
              <div className="task-dialog-attention">Choose an exact date in the next seven days.</div>
            ) : null}
            <div className="task-property-list">
              {task.seriesId ? <div className="task-property-row"><Repeat2 size={15} aria-hidden="true" /><span className="task-property-label">Apply to</span><Select value={draft.recurrenceScope ?? 'this'} options={[{ value: 'this', label: 'This occurrence' }, { value: 'future', label: 'This and future occurrences' }]} onChange={(value) => setDraft({ ...draft, recurrenceScope: value as 'this' | 'future' })} placeholder="Scope" ariaLabel="Recurring task edit scope" /></div> : null}
              <div className="task-property-row">
                <Check size={15} aria-hidden="true" />
                <span className="task-property-label">Status</span>
                <Select
                  value={draft.status}
                  options={STATUS_OPTIONS}
                  onChange={(status) => setDraft({ ...draft, status: status as TaskStatus })}
                  placeholder="Empty"
                  ariaLabel="Status"
                />
              </div>
              <div className="task-property-row">
                <CalendarDays size={15} aria-hidden="true" />
                <span className="task-property-label">Due</span>
                <DueDatePicker
                  today={today}
                  value={draft.due}
                  onChange={(due) => setDraft({ ...draft, due })}
                  ariaLabel="Due date"
                  min={null}
                  max={null}
                />
              </div>
              <div className="task-property-row">
                <Layers3 size={15} aria-hidden="true" />
                <span className="task-property-label">Context</span>
                <ContextSelect
                  value={draft.context}
                  contexts={contexts}
                  onChange={(context) => setDraft((current) => current === null ? null : { ...current, context })}
                  onAdd={onAddContext}
                  onUpdate={updateContextDefinition}
                  onDelete={async (name) => {
                    const selected = draft.context === name
                    setDraft((current) => current !== null && current.context === name ? { ...current, context: task.context } : current)
                    try {
                      await onDeleteContext(name)
                    } catch (error) {
                      if (selected) setDraft((current) => current !== null && current.context === task.context ? { ...current, context: name } : current)
                      throw error
                    }
                  }}
                  placeholder="Empty"
                  ariaLabel="Context"
                />
              </div>
              <div className="task-property-row">
                <Clock3 size={15} aria-hidden="true" />
                <span className="task-property-label">Estimate</span>
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
              <div className="task-property-row">
                <Flag size={15} aria-hidden="true" />
                <span className="task-property-label">Priority</span>
                <Select
                  value={draft.priority}
                  options={PRIORITY_OPTIONS}
                  onChange={(priority) => setDraft({ ...draft, priority: priority as TaskPriority })}
                  placeholder="Empty"
                  ariaLabel="Priority"
                />
              </div>
              <div className="task-property-row task-property-row--expandable">
                <Repeat2 size={15} aria-hidden="true" />
                <span className="task-property-label">Repeats</span>
                <button
                  type="button"
                  className="task-recurrence-trigger"
                  aria-expanded={recurrenceOpen}
                  data-testid="task-recurrence-trigger"
                  onClick={() => setRecurrenceOpen(!recurrenceOpen)}
                >
                  <span>{draft.recurrence === null ? "Doesn't repeat" : recurrenceLabel(draft.recurrence)}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </div>
              {recurrenceOpen ? (
                <div className="task-recurrence-panel" data-testid="task-recurrence-panel">
                  <RecurrenceEditor key={task.id} value={draft.recurrence} onChange={(recurrence) => setDraft({ ...draft, recurrence })} />
                </div>
              ) : null}
            </div>

            {saveError !== null ? <p className="task-dialog-error" role="alert">{saveError}</p> : null}

            <div className="task-dialog-footer task-dialog-footer--detail">
              <Button
                variant="primary"
                icon={<Check size={16} />}
                disabled={!dirty || saving}
                onClick={closeWithSave}
              >
                Save changes
              </Button>
              <div className="task-dialog-secondary-actions">
                <button
                  type="button"
                  className="peek-duplicate"
                  onClick={() => {
                    if (saving) return
                    setSaving(true)
                    setSaveError(null)
                    void saveDraft().then(() => onDuplicate(normalizedDraft())).catch((error: Error) => setSaveError(error.message)).finally(() => setSaving(false))
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
      </section>
    </Modal>
  )
}
