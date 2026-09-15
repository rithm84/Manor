import { CalendarDays, ChevronDown, Clock3, Flag, Layers3, Repeat2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button, Modal, Select } from '../../components/ui'
import type {
  ContextDefinition,
  ContextDraft,
  TaskBucket,
  TaskEstimateMinutes,
  TaskPriority
} from '../../data/mock'
import { ContextSelect } from './ContextSelect'
import { DueDatePicker } from './DueDatePicker'
import { RecurrenceEditor } from './RecurrenceEditor'
import { recurrenceLabel } from '../../../shared/recurrence'
import {
  ESTIMATE_SELECT_OPTIONS,
  PRIORITY_OPTIONS,
  taskCreationDefaults
} from './taskModel'
import type { DraftTask } from './taskModel'
import './homeDetails.css'
import './taskDialogs.css'

export interface TaskCreateDialogProps {
  bucket: TaskBucket | null
  today: string
  contexts: readonly ContextDefinition[]
  onAddContext: (context: ContextDraft) => Promise<ContextDefinition>
  onUpdateContext: (originalName: string, context: ContextDraft) => Promise<ContextDefinition>
  onDeleteContext: (name: string) => Promise<void>
  onCreate: (bucket: TaskBucket, draft: DraftTask) => Promise<void>
  onClose: () => void
}

function emptyDraft(bucket: TaskBucket, today: string): DraftTask {
  const defaults = taskCreationDefaults(bucket, today)
  return {
    title: '',
    context: defaults.context,
    due: defaults.due,
    estimateMinutes: null,
    priority: null,
    recurrence: null
  }
}

function sameDraft(left: DraftTask, right: DraftTask): boolean {
  return (
    left.title === right.title &&
    left.context === right.context &&
    left.due === right.due &&
    left.estimateMinutes === right.estimateMinutes &&
    left.priority === right.priority &&
    left.recurrence === right.recurrence
  )
}

function bucketName(bucket: TaskBucket): string {
  if (bucket === 'today') return 'Today'
  if (bucket === 'tomorrow') return 'Tomorrow'
  if (bucket === 'week') return 'This Week'
  throw new RangeError('Overdue does not support task creation')
}

/** Shared task creation surface for every creatable Home entry point. */
export function TaskCreateDialog({
  bucket,
  today,
  contexts,
  onAddContext,
  onUpdateContext,
  onDeleteContext,
  onCreate,
  onClose
}: TaskCreateDialogProps): ReactNode {
  const activeBucket = bucket ?? 'today'
  const [draft, setDraft] = useState<DraftTask>(() => emptyDraft(activeBucket, today))
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (bucket === null) return
    setDraft(emptyDraft(bucket, today))
    setSaving(false)
    setConfirmDiscard(false)
    setCreateError(null)
    setRecurrenceOpen(false)
  }, [bucket, today])

  const dirty = bucket !== null && !sameDraft(draft, emptyDraft(activeBucket, today))

  // Closing a property picker hands focus back to the dialog panel, where a plain Enter
  // otherwise does nothing. The shortcut promises Enter creates the task wherever focus rests,
  // so Enter on the panel or the form submits; controls, open pickers, and text fields keep theirs.
  useEffect(() => {
    if (bucket === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const current = form.current
      const panel = current?.closest<HTMLElement>('[aria-modal="true"]') ?? null
      if (current === null || panel === null || !(event.target instanceof HTMLElement)) return
      const target = event.target
      if (target !== panel && target !== current) {
        if (!panel.contains(target)) return
        if (target.closest('input, textarea, select, button, a[href], [role="option"], [role="radio"], [role="listbox"], [role="menu"], [contenteditable="true"]') !== null) return
      }
      if (panel.querySelector('[aria-expanded="true"]') !== null) return
      event.preventDefault()
      current.requestSubmit()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [bucket])

  // Escape, scrim, and Cancel all prompt before discarding typed work.
  const requestClose = (): void => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const title = draft.title.trim()
    if (title === '' || draft.context === null || draft.due === null || saving) return
    setSaving(true)
    setCreateError(null)
    try {
      await onCreate(activeBucket, { ...draft, title })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create this task')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit =
    draft.title.trim() !== '' && draft.context !== null && draft.due !== null && !saving

  return (
    <>
    <Modal
      open={bucket !== null}
      onClose={requestClose}
      width={520}
      ariaLabel={`New task for ${bucketName(activeBucket)}`}
    >
      <form ref={form} className="task-dialog" onSubmit={(event) => void submit(event)} data-testid="task-create-dialog">
        <header className="task-dialog-header">
          <h2>New task</h2>
          <button type="button" className="task-dialog-close" aria-label="Close new task" onClick={requestClose}>
            <X size={16} />
          </button>
        </header>

        <label className="task-dialog-title">
          <input
            autoFocus
            required
            maxLength={160}
            value={draft.title}
            placeholder="What needs doing?"
            aria-label="Task title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <div className="task-property-list">
          <div className="task-property-row">
            <Layers3 size={15} aria-hidden="true" />
            <span className="task-property-label">Context <span aria-hidden="true">*</span></span>
            <ContextSelect
              value={draft.context}
              contexts={contexts}
              onChange={(context) => setDraft((current) => ({ ...current, context }))}
              onAdd={onAddContext}
              onUpdate={onUpdateContext}
              onDelete={async (name) => {
                const selected = draft.context === name
                setDraft((current) => current.context === name ? { ...current, context: null } : current)
                try {
                  await onDeleteContext(name)
                } catch (error) {
                  if (selected) setDraft((current) => current.context === null ? { ...current, context: name } : current)
                  throw error
                }
              }}
              placeholder="Choose or add Context"
              ariaLabel="Context, required"
            />
          </div>

          <div className="task-property-row">
            <CalendarDays size={15} aria-hidden="true" />
            <span className="task-property-label">Due <span aria-hidden="true">*</span></span>
            <DueDatePicker
              today={today}
              value={draft.due}
              onChange={(due) => setDraft({ ...draft, due })}
              ariaLabel="Due date"
              min={today}
              max={null}
            />
          </div>

          <div className="task-property-row">
            <Clock3 size={15} aria-hidden="true" />
            <span className="task-property-label">Estimate</span>
            <Select
              value={draft.estimateMinutes === null ? null : String(draft.estimateMinutes)}
              options={ESTIMATE_SELECT_OPTIONS}
              onChange={(value) => setDraft({ ...draft, estimateMinutes: Number(value) as TaskEstimateMinutes })}
              placeholder="None"
              ariaLabel="Time estimate"
            />
          </div>

          <div className="task-property-row">
            <Flag size={15} aria-hidden="true" />
            <span className="task-property-label">Priority</span>
            <Select
              value={draft.priority}
              options={PRIORITY_OPTIONS}
              onChange={(value) => setDraft({ ...draft, priority: value as TaskPriority })}
              placeholder="None"
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
              data-testid="task-create-recurrence-trigger"
              onClick={() => setRecurrenceOpen((open) => !open)}
            >
              <span>{draft.recurrence === null ? "Doesn't repeat" : recurrenceLabel(draft.recurrence)}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          {recurrenceOpen ? (
            <div className="task-recurrence-panel" data-testid="task-create-recurrence-panel">
              <RecurrenceEditor
                value={draft.recurrence}
                onChange={(recurrence) => setDraft((current) => ({ ...current, recurrence }))}
              />
            </div>
          ) : null}
        </div>

        {activeBucket === 'week' && draft.due === null ? (
          <p className="task-dialog-hint">Choose an exact date in the next seven days.</p>
        ) : null}

        {createError !== null ? (
          <span className="task-dialog-error" role="alert">{createError}</span>
        ) : null}

        <footer className="task-dialog-footer">
          <span className="task-dialog-shortcut"><kbd>Enter</kbd> to create</span>
          <button type="submit" className="ui-button ui-button--primary" disabled={!canSubmit}>
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </footer>
      </form>
    </Modal>
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      width={380}
      ariaLabel="Discard this task"
    >
      <div className="ui-confirm">
        <h2>Discard this task?</h2>
        <p>It has not been created yet.</p>
        <div className="ui-confirm-actions">
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmDiscard(false)
              onClose()
            }}
          >
            Discard
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
