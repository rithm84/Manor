import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Button, DatePicker, DetailDialog, Select, TimePicker } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { ScratchBlock, Task } from '../../data/mock'
import { isTimeString, minutesToTime, scratchExpiry, timeToMinutes } from './taskModel'

export interface ScratchBlockDialogProps {
  block: ScratchBlock | null
  task: Task | null
  open: boolean
  today?: string
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
  today,
  onClose,
  onUpdate,
  onDelete
}: ScratchBlockDialogProps): ReactNode {
  const [draft, setDraft] = useState<ScratchBlock | null>(block)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [timeValid, setTimeValid] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDraft(block)
    setScheduleError(null)
    setTimeValid(true)
    setSaveError(null)
  }, [block?.id, open])
  if (block === null || draft === null) return null
  const duration = timeToMinutes(draft.end) - timeToMinutes(draft.start)
  const updateSchedule = (start: string, minutes: number): void => {
    if (!isTimeString(start)) return
    const endMinutes = timeToMinutes(start) + minutes
    if (timeToMinutes(start) < 360 || endMinutes > 24 * 60 || timeToMinutes(start) % 15 !== 0) {
      setScheduleError('Choose a 15-minute boundary between 6 AM and midnight.')
      return
    }
    const end = minutesToTime(endMinutes)
    setScheduleError(null)
    setDraft({ ...draft, start, end, expiresAt: scratchExpiry(draft.date, end) })
  }

  const updateDate = (date: string | null): void => {
    if (date === null) throw new Error('A time block date is required')
    setDraft({ ...draft, date, expiresAt: scratchExpiry(date, draft.end) })
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  const closeWithSave = async (): Promise<void> => {
    if (saving || scheduleError !== null) return
    if (!timeValid) { setSaveError('Enter a valid start time before saving.'); return }
    if (JSON.stringify(draft) === JSON.stringify(block)) { onClose(); return }
    setSaving(true)
    setSaveError(null)
    try {
      await onUpdate(draft)
      onClose()
    } catch (error: unknown) {
      setSaveError(`Could not save the time block: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const deleteBlock = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onDelete(block.id)
      onClose()
    } catch (error: unknown) {
      setSaveError(`Could not delete the time block: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const accessibleTitle =
    task !== null ? task.title : block.portion.trim() === '' ? 'Time block' : block.portion

  /* Freestanding blocks edit their label directly in the dialog header. */
  const dialogTitle =
    task !== null ? (
      task.title
    ) : (
      <input
        className="block-title-input"
        autoFocus={block.portion === ''}
        value={draft.portion}
        maxLength={80}
        placeholder="What is this time for?"
        aria-label="Time block title"
        onChange={(event) => setDraft({ ...draft, portion: event.target.value })}
        onKeyDown={onTitleKeyDown}
      />
    )

  return (
    <DetailDialog
      open={open}
      onClose={() => void closeWithSave()}
      title={dialogTitle}
      width={440}
      ariaLabel={`Time block details for ${accessibleTitle}`}
    >
      <div className="block-peek">
        <div className="block-fields">
          <div className="block-property-row"><span className="block-property-label">Date</span><DatePicker today={today} value={draft.date} onChange={updateDate} ariaLabel="Block date" min={null} max={null} required /></div>
          {task !== null ? <div className="block-property-row"><span className="block-property-label">Portion</span><input className="ui-input" aria-label="Time block portion" value={draft.portion} onChange={(event) => setDraft({ ...draft, portion: event.target.value })} /></div> : null}
          <div className="block-property-row">
            <span className="block-property-label">Starts</span>
            <TimePicker value={draft.start} onChange={(time) => updateSchedule(time, duration)} ariaLabel="Block start time" format="12h" onValidityChange={setTimeValid} />
          </div>
          <div className="block-property-row">
            <span className="block-property-label">Duration</span>
            <Select
              value={String(duration)}
              options={durationOptions(duration)}
              onChange={(value) => updateSchedule(draft.start, Number(value))}
              placeholder="Duration"
              ariaLabel="Block duration"
            />
          </div>
          {scheduleError !== null ? <span className="block-error" role="alert">{scheduleError}</span> : null}
          {saveError !== null ? <span className="block-error" role="alert">{saveError}</span> : null}
        </div>


        <div className="block-actions">
          <Button ariaLabel="Save time block" variant="primary" disabled={saving} onClick={() => void closeWithSave()}>{saving ? 'Saving…' : 'Done'}</Button>
          <button type="button" className="peek-delete" disabled={saving} onClick={() => void deleteBlock()}>
            <Trash2 size={15} />
            Delete block
          </button>
        </div>
      </div>
    </DetailDialog>
  )
}
