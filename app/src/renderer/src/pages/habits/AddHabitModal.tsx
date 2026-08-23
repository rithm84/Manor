import { Check, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Input, Modal } from '../../components/ui'
import type { HabitDraft, HabitKind } from '../../../../shared/habits'

export interface HabitEditorModalProps {
  open: boolean
  initialDraft: HabitDraft | null
  onClose: () => void
  onSave: (draft: HabitDraft) => void
}

const EMPTY_DRAFT: HabitDraft = { name: '', kind: 'binary', targetLabel: null }

export function HabitEditorModal({
  open,
  initialDraft,
  onClose,
  onSave
}: HabitEditorModalProps): ReactNode {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<HabitKind>('binary')
  const [targetLabel, setTargetLabel] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    const draft = initialDraft ?? EMPTY_DRAFT
    setName(draft.name)
    setKind(draft.kind)
    setTargetLabel(draft.targetLabel ?? '')
  }, [initialDraft, open])

  const submit = (): void => {
    onSave({
      name: name.trim(),
      kind,
      targetLabel: kind === 'quantized' ? targetLabel.trim() : null
    })
  }
  const valid = name.trim() !== '' && (kind === 'binary' || targetLabel.trim() !== '')
  const editing = initialDraft !== null
  const changingToBinary = initialDraft?.kind === 'quantized' && kind === 'binary'

  return (
    <Modal open={open} onClose={onClose} width={460} ariaLabel={editing ? 'Edit habit' : 'New habit'}>
      <div className="habit-add">
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
              <span className="habit-add-kind-name">In quarters</span>
              <span className="habit-add-kind-sub">0, 25, 50, 75, or 100%</span>
            </button>
          </div>
        </div>

        {kind === 'quantized' ? (
          <label className="habit-add-field">
            <span className="habit-add-label">Daily target</span>
            <Input
              value={targetLabel}
              onChange={setTargetLabel}
              placeholder="48 oz, 25 pages, 105 g"
              ariaLabel="Daily target"
            />
          </label>
        ) : null}

        {changingToBinary ? (
          <p className="habit-edit-note">
            Past entries keep their recorded percentages. From today, this habit becomes one tap.
          </p>
        ) : null}

        <div className="habit-add-footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>
            {editing ? 'Save changes' : 'Add habit'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
