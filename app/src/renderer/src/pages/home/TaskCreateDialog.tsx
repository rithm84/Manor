import { CalendarDays } from 'lucide-react'
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
  formatLongDayLabel,
  taskCreationDateRange,
  taskCreationDefaults
} from './taskModel'
import type { DraftTask } from './taskModel'

export interface TaskCreateDialogProps {
  bucket: TaskBucket | null
  today: string
  contexts: readonly ContextDefinition[]
  onAddContext: (context: ContextDraft) => Promise<ContextDefinition>
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
  onCreate,
  onClose
}: TaskCreateDialogProps): ReactNode {
  const activeBucket = bucket ?? 'today'
  const [draft, setDraft] = useState<DraftTask>(() => emptyDraft(activeBucket, today))
  const [saving, setSaving] = useState(false)
  const dateRange = taskCreationDateRange(activeBucket, today)

  useEffect(() => {
    if (bucket === null) return
    setDraft(emptyDraft(bucket, today))
    setSaving(false)
  }, [bucket, today])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const title = draft.title.trim()
    if (title === '' || draft.context === null || draft.due === null || saving) return
    setSaving(true)
    try {
      await onCreate(activeBucket, { ...draft, title })
    } finally {
      setSaving(false)
    }
  }

  const exactDateRequired = activeBucket === 'week'
  const canSubmit =
    draft.title.trim() !== '' && draft.context !== null && draft.due !== null && !saving

  return (
    <Modal
      open={bucket !== null}
      onClose={onClose}
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

          <div className={`task-create-field task-create-due${exactDateRequired ? ' is-exact' : ''}`}>
            <div className="task-create-due-heading">
              <span className="task-create-label">Due date <span aria-hidden="true">*</span></span>
              {exactDateRequired && dateRange !== null ? (
                <span className="task-create-range">
                  Choose an exact date from {formatLongDayLabel(dateRange.min)} to {formatLongDayLabel(dateRange.max)}
                </span>
              ) : null}
            </div>
            {exactDateRequired && dateRange !== null ? (
              <DueDatePicker
                value={draft.due}
                onChange={(due) => setDraft({ ...draft, due })}
                ariaLabel="Exact due date for This Week task"
                min={dateRange.min}
                max={dateRange.max}
              />
            ) : draft.due !== null ? (
              <div className="task-create-locked-date" aria-label={`Due ${formatLongDayLabel(draft.due)}`}>
                <CalendarDays size={15} />
                <span>{formatLongDayLabel(draft.due)}</span>
                <span className="task-create-locked-label">Fixed for {bucketName(activeBucket)}</span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="task-create-actions">
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <button type="submit" className="ui-button ui-button--primary" disabled={!canSubmit}>
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
