import { Check, GlassWater } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Input, Modal, Select } from '../../components/ui'
import type { HabitCadence, HabitDraft, HabitKind } from './habitModel'

export interface AddHabitModalProps {
  open: boolean
  onClose: () => void
  onAdd: (draft: HabitDraft) => void
}

const CADENCE_OPTIONS = [
  { value: 'Every day', label: 'Every day' },
  { value: 'Weekdays', label: 'Weekdays' },
  { value: 'Weekends', label: 'Weekends' }
] as const

/** New-habit flow: name, cadence, and how it gets logged. */
export function AddHabitModal({ open, onClose, onAdd }: AddHabitModalProps): ReactNode {
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState<HabitCadence>('Every day')
  const [kind, setKind] = useState<HabitKind>('check')
  const [targetLabel, setTargetLabel] = useState('')

  const reset = (): void => {
    setName('')
    setCadence('Every day')
    setKind('check')
    setTargetLabel('')
  }

  const submit = (): void => {
    onAdd({ name: name.trim(), cadence, kind, targetLabel: targetLabel.trim() })
    reset()
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      width={460}
      ariaLabel="New habit"
    >
      <div className="habit-add">
        <h2 className="habit-add-title">New habit</h2>

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
          <span className="habit-add-label">Cadence</span>
          <Select
            value={cadence}
            options={CADENCE_OPTIONS}
            onChange={(value) => setCadence(value as HabitCadence)}
            placeholder="Every day"
            ariaLabel="Habit cadence"
          />
        </div>

        <div className="habit-add-field">
          <span className="habit-add-label">How you log it</span>
          <div className="habit-add-kinds" role="radiogroup" aria-label="How you log it">
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'check'}
              className={`habit-add-kind${kind === 'check' ? ' is-selected' : ''}`}
              onClick={() => setKind('check')}
            >
              <Check size={16} />
              <span className="habit-add-kind-name">One tap</span>
              <span className="habit-add-kind-sub">Done or not, checked in a tap</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={kind === 'steps'}
              className={`habit-add-kind${kind === 'steps' ? ' is-selected' : ''}`}
              onClick={() => setKind('steps')}
            >
              <GlassWater size={16} />
              <span className="habit-add-kind-name">In steps</span>
              <span className="habit-add-kind-sub">Fill it up through the day</span>
            </button>
          </div>
        </div>

        {kind === 'steps' ? (
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

        <div className="habit-add-footer">
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={name.trim() === ''}>
            Add habit
          </Button>
        </div>
      </div>
    </Modal>
  )
}
