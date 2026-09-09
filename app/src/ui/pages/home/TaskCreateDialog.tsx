import { useEffect, useState } from 'react'
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
import {
  ESTIMATE_SELECT_OPTIONS,
  PRIORITY_OPTIONS,
  taskCreationDefaults
} from './taskModel'
import type { DraftTask } from './taskModel'

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
    priority: null
  }
}

function sameDraft(left: DraftTask, right: DraftTask): boolean {
  return (
    left.title === right.title &&
    left.context === right.context &&
    left.due === right.due &&
    left.estimateMinutes === right.estimateMinutes &&
    left.priority === right.priority
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

  useEffect(() => {
    if (bucket === null) return
    setDraft(emptyDraft(bucket, today))
    setSaving(false)
    setConfirmDiscard(false)
    setCreateError(null)
  }, [bucket, today])

  const dirty = bucket !== null && !sameDraft(draft, emptyDraft(activeBucket, today))

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
      width={560}
      ariaLabel={`New task for ${bucketName(activeBucket)}`}
    >
      <form className="task-create-dialog" onSubmit={(event) => void submit(event)}>
        <header className="task-create-header">
          <div>
            <span className="task-create-eyebrow">New task</span>
            <h2>{bucketName(activeBucket)}</h2>
          </div>
        </header>

        <label className="task-create-title">
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

        <div className="task-create-properties">
          <div className="task-create-field">
            <span className="task-create-label">Context <span aria-hidden="true">*</span></span>
            <ContextSelect
              value={draft.context}
              contexts={contexts}
              onChange={(context) => setDraft({ ...draft, context })}
              onAdd={onAddContext}
              onUpdate={onUpdateContext}
              onDelete={onDeleteContext}
              placeholder="Choose or add Context"
              ariaLabel="Context, required"
            />
          </div>

          <div className="task-create-property-grid">
            <div className="task-create-field">
              <span className="task-create-label">Time estimate</span>
              <Select
                value={draft.estimateMinutes === null ? null : String(draft.estimateMinutes)}
                options={ESTIMATE_SELECT_OPTIONS}
                onChange={(value) =>
                  setDraft({ ...draft, estimateMinutes: Number(value) as TaskEstimateMinutes })
                }
                placeholder="Choose time"
                ariaLabel="Time estimate"
              />
            </div>
            <div className="task-create-field">
              <span className="task-create-label">Priority</span>
              <Select
                value={draft.priority}
                options={PRIORITY_OPTIONS}
                onChange={(value) => setDraft({ ...draft, priority: value as TaskPriority })}
                placeholder="Choose priority"
                ariaLabel="Priority"
              />
            </div>
          </div>

          <div className={`task-create-field task-create-due${activeBucket === 'week' ? ' is-exact' : ''}`}>
            <div className="task-create-due-heading">
              <span className="task-create-label">Due date <span aria-hidden="true">*</span></span>
              {activeBucket === 'week' ? (
                <span className="task-create-range">Choose the exact day</span>
              ) : null}
            </div>
            <DueDatePicker
              value={draft.due}
              onChange={(due) => setDraft({ ...draft, due })}
              ariaLabel="Due date"
              min={today}
              max={null}
            />
          </div>
        </div>

        {createError !== null ? (
          <span className="task-create-error" role="alert">{createError}</span>
        ) : null}

        <footer className="task-create-actions">
          <Button variant="subtle" onClick={requestClose}>Cancel</Button>
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
