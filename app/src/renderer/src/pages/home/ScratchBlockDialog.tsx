import { Clock3, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, DetailDialog, Select } from '../../components/ui'
import type { ScratchBlock, Task } from '../../data/mock'
import { DueDatePicker } from './DueDatePicker'
import { minutesToTime, scratchExpiry, timeToMinutes } from './taskModel'

export interface ScratchBlockDialogProps {
  block: ScratchBlock | null
  task: Task | null
  open: boolean
  onClose: () => void
  onUpdate: (block: ScratchBlock) => Promise<void>
  onDelete: (blockId: string) => Promise<void>
}

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' }
] as const

export function ScratchBlockDialog({
  block,
  task,
  open,
  onClose,
  onUpdate,
  onDelete
}: ScratchBlockDialogProps): ReactNode {
  const [portion, setPortion] = useState(block?.portion ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  useEffect(() => {
    setPortion(block?.portion ?? '')
    setScheduleError(null)
  }, [block?.id, block?.portion])

  if (block === null || task === null) return null

  const duration = timeToMinutes(block.end) - timeToMinutes(block.start)

  const updateSchedule = (date: string, start: string, minutes: number): void => {
    const endMinutes = timeToMinutes(start) + minutes
    if (endMinutes > 24 * 60) {
      setScheduleError('This block must end by midnight.')
      return
    }
    const end = minutesToTime(endMinutes)
    setScheduleError(null)
    void onUpdate({ ...block, date, start, end, expiresAt: scratchExpiry(date, end) })
  }

  const savePortion = (): void => {
    const next = portion.trim()
    if (next !== '' && next !== block.portion) {
      void onUpdate({ ...block, portion: next })
    }
  }

  return (
    <DetailDialog
      open={open}
      onClose={onClose}
      title={task.title}
      width={440}
      ariaLabel={`Time block details for ${task.title}`}
    >
      <div className="block-peek">
        <div className="block-peek-icon"><Clock3 size={18} /></div>
        <div className="peek-props">
          <div className="peek-row">
            <span className="peek-label">Day</span>
            <DueDatePicker
              value={block.date}
              onChange={(date) => updateSchedule(date, block.start, duration)}
              ariaLabel="Block date"
              min={null}
              max={null}
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Starts</span>
            <input
              className="block-time-input tnum"
              type="time"
              step={900}
              value={block.start}
              aria-label="Block start time"
              onChange={(event) => updateSchedule(block.date, event.target.value, duration)}
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Duration</span>
            <Select
              value={String(duration)}
              options={DURATION_OPTIONS}
              onChange={(value) => updateSchedule(block.date, block.start, Number(value))}
              placeholder="Duration"
              ariaLabel="Block duration"
            />
          </div>
          <label className="block-portion">
            <span className="peek-label">Part</span>
            <input
              value={portion}
              maxLength={80}
              placeholder="full task"
              aria-label="Part of task"
              onChange={(event) => setPortion(event.target.value)}
              onBlur={savePortion}
            />
          </label>
          {scheduleError !== null ? <span className="block-error">{scheduleError}</span> : null}
        </div>

        <div className="block-note">
          This block is separate from the task and is removed two days after it ends.
        </div>

        <div className="peek-actions">
          <Button variant="subtle" onClick={() => onClose()}>Done</Button>
          <button type="button" className="peek-delete" onClick={() => void onDelete(block.id)}>
            <Trash2 size={15} />
            Delete block
          </button>
        </div>
      </div>
    </DetailDialog>
  )
}
