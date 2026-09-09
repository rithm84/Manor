import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button, DetailDialog, Select } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { ScratchBlock, Task } from '../../data/mock'
import { isTimeString, minutesToTime, scratchExpiry, timeToMinutes } from './taskModel'

export interface ScratchBlockDialogProps {
  block: ScratchBlock | null
  task: Task | null
  open: boolean
  onClose: () => void
  onUpdate: (block: ScratchBlock) => Promise<void>
  onDelete: (blockId: string) => Promise<void>
}

const BASE_DURATIONS: readonly number[] = [15, 30, 45, 60, 90, 120, 180]

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  if (minutes === 60) return '1 hour'
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

/** The preset ladder plus the block's own length, so any dragged duration
    shows as the selected value instead of an empty placeholder. */
export function durationOptions(current: number): readonly SelectOption[] {
  return [...new Set([...BASE_DURATIONS, current])]
    .sort((left, right) => left - right)
    .map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) }))
}

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

  if (block === null) return null

  const duration = timeToMinutes(block.end) - timeToMinutes(block.start)

  const updateSchedule = (start: string, minutes: number): void => {
    // A cleared or half-typed time input is transient editing, not an error.
    if (!isTimeString(start)) return
    const endMinutes = timeToMinutes(start) + minutes
    if (endMinutes > 24 * 60) {
      setScheduleError('This block must end by midnight.')
      return
    }
    const end = minutesToTime(endMinutes)
    setScheduleError(null)
    void onUpdate({ ...block, start, end, expiresAt: scratchExpiry(block.date, end) })
  }

  const savePortion = (): void => {
    const next = portion.trim()
    if (next === '') {
      setPortion(block.portion)
      return
    }
    if (next !== block.portion) {
      void onUpdate({ ...block, portion: next })
    }
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  // Closing must save the sticky title itself; blur does not fire on unmount.
  const closeWithSave = (): void => {
    savePortion()
    onClose()
  }

  const accessibleTitle =
    task !== null ? task.title : block.portion.trim() === '' ? 'Sticky note' : block.portion

  /* A sticky's text is its title: directly editable in the header,
     Notion click-to-edit style, like the task dialog. */
  const dialogTitle =
    task !== null ? (
      task.title
    ) : (
      <input
        className="peek-title-input"
        autoFocus={block.portion === ''}
        value={portion}
        maxLength={80}
        placeholder="What is this time for?"
        aria-label="Sticky note title"
        onChange={(event) => setPortion(event.target.value)}
        onBlur={savePortion}
        onKeyDown={onTitleKeyDown}
      />
    )

  return (
    <DetailDialog
      open={open}
      onClose={closeWithSave}
      title={dialogTitle}
      width={440}
      ariaLabel={`Time block details for ${accessibleTitle}`}
    >
      <div className="block-peek">
        <div className="peek-props">
          <div className="peek-row">
            <span className="peek-label">Starts</span>
            <input
              className="block-time-input tnum"
              type="time"
              step={900}
              value={block.start}
              aria-label="Block start time"
              onChange={(event) => updateSchedule(event.target.value, duration)}
            />
          </div>
          <div className="peek-row">
            <span className="peek-label">Duration</span>
            <Select
              value={String(duration)}
              options={durationOptions(duration)}
              onChange={(value) => updateSchedule(block.start, Number(value))}
              placeholder="Duration"
              ariaLabel="Block duration"
            />
          </div>
          {scheduleError !== null ? <span className="block-error">{scheduleError}</span> : null}
        </div>


        <div className="peek-actions">
          <Button variant="subtle" onClick={() => closeWithSave()}>Done</Button>
          <button type="button" className="peek-delete" onClick={() => void onDelete(block.id)}>
            <Trash2 size={15} />
            Delete block
          </button>
        </div>
      </div>
    </DetailDialog>
  )
}
