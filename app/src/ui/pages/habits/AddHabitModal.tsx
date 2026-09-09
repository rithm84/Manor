import { Check, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { Button, Input, Modal } from '../../components/ui'
import { habitSteps, targetUnitCount } from '../../../shared/habits'
import type { HabitDraft, HabitKind } from '../../../shared/habits'

export interface HabitEditorModalProps {
  open: boolean
  initialDraft: HabitDraft | null
  onClose: () => void
  onSave: (draft: HabitDraft) => Promise<void>
}

const EMPTY_DRAFT: HabitDraft = { name: '', kind: 'binary', targetLabel: null }

/** Live preview of the logging steps a target produces ("3 tablets" logs
    one tablet per tap; larger or unitless targets log in quarters). */
function stepsHint(targetLabel: string): string {
  const count = targetUnitCount(targetLabel)
  const steps = habitSteps(targetLabel)
  if (count !== null && steps.length === count) {
    return count === 1 ? 'Logged in one step' : `Logged one at a time, in ${count} steps`
  }
  return 'Logged in quarters'
}

export function HabitEditorModal({
  open,
  initialDraft,
  onClose,
  onSave
}: HabitEditorModalProps): ReactNode {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<HabitKind>('binary')
  const [targetLabel, setTargetLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    const draft = initialDraft ?? EMPTY_DRAFT
    setName(draft.name)
    setKind(draft.kind)
    setTargetLabel(draft.targetLabel ?? '')
    setSaving(false)
    setConfirmDiscard(false)
  }, [initialDraft, open])

  const valid = name.trim() !== '' && (kind === 'binary' || targetLabel.trim() !== '')
  const editing = initialDraft !== null
  const changingToBinary = initialDraft?.kind === 'quantized' && kind === 'binary'
  const baseline = initialDraft ?? EMPTY_DRAFT
  const dirty =
    name !== baseline.name ||
    kind !== baseline.kind ||
    targetLabel !== (baseline.targetLabel ?? '')

  // Escape, scrim, and Cancel all prompt before discarding typed fields.
  const requestClose = (): void => {
    if (saving) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        kind,
        targetLabel: kind === 'quantized' ? targetLabel.trim() : null
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <Modal open={open} onClose={requestClose} width={460} ariaLabel={editing ? 'Edit habit' : 'New habit'}>
      <form className="habit-add" onSubmit={(event) => void submit(event)}>
        <h2 className="habit-add-title">{editing ? 'Edit habit' : 'New habit'}</h2>

        <label className="habit-add-field">
          <span className="habit-add-label">Name</span>
          <Input
            value={name}
            onChange={setName}
            placeholder="Stretch 10 minutes"
            ariaLabel="Habit name"
            autoFocus
          />
        </label>

        <div className="habit-add-field">
          <span className="habit-add-label">How you log it</span>
          <div className="habit-add-kinds" role="radiogroup" aria-label="How you log it">
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'binary'}
              className={`habit-add-kind${kind === 'binary' ? ' is-selected' : ''}`}
              onClick={() => setKind('binary')}
            >
              <Check size={16} />
              <span className="habit-add-kind-name">One tap</span>
              <span className="habit-add-kind-sub">Complete or incomplete</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'quantized'}
              className={`habit-add-kind${kind === 'quantized' ? ' is-selected' : ''}`}
              onClick={() => setKind('quantized')}
            >
              <Gauge size={16} />
              <span className="habit-add-kind-name">By amount</span>
              <span className="habit-add-kind-sub">Partial progress counts</span>
            </button>
          </div>
        </div>

        {kind === 'quantized' ? (
          <label className="habit-add-field">
            <span className="habit-add-label">Daily target</span>
            <Input
              value={targetLabel}
              onChange={setTargetLabel}
              placeholder="3 tablets, 48 oz, 25 pages"
              ariaLabel="Daily target"
            />
            {targetLabel.trim() !== '' ? (
              <span className="habit-add-steps-hint">{stepsHint(targetLabel.trim())}</span>
            ) : null}
          </label>
        ) : null}

        {changingToBinary ? (
          <p className="habit-edit-note">
            Past entries keep their recorded percentages. From today, this habit becomes one tap.
          </p>
        ) : null}

        <div className="habit-add-footer">
          <Button variant="ghost" onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <button
            className="ui-button ui-button--primary"
            type="submit"
            disabled={!valid || saving}
          >
            {editing ? 'Save changes' : 'Add habit'}
          </button>
        </div>
      </form>
    </Modal>
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      width={380}
      ariaLabel={editing ? 'Discard these changes' : 'Discard this habit'}
    >
      <div className="ui-confirm">
        <h2>{editing ? 'Discard these changes?' : 'Discard this habit?'}</h2>
        <p>{editing ? 'They have not been saved.' : 'It has not been added yet.'}</p>
        <div className="ui-confirm-actions">
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
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
