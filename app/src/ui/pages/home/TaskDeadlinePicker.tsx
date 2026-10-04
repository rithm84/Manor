import { Clock3, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { TimePicker } from '../../components/ui'
import { DueDatePicker } from './DueDatePicker'

interface TaskDeadlinePickerProps {
  date: string | null
  time: string | null
  today: string | undefined
  min: string | null
  onDateChange: (date: string) => void
  onTimeChange: (time: string | null) => void
  onValidityChange: (valid: boolean) => void
}

/** Date-only deadlines remain available; optional times accept any minute. */
export function TaskDeadlinePicker({ date, time, today, min, onDateChange, onTimeChange, onValidityChange }: TaskDeadlinePickerProps): ReactNode {
  return (
    <div className="task-deadline-picker" data-testid="task-deadline-picker">
      <DueDatePicker today={today} value={date} onChange={onDateChange} ariaLabel="Due date" min={min} max={null} />
      {time === null ? (
        <button type="button" className="task-deadline-add" aria-label="Add due time" onClick={() => onTimeChange('12:00')}>
          <Clock3 size={14} /> Add time
        </button>
      ) : (
        <div className="task-deadline-time">
          <TimePicker value={time} onChange={onTimeChange} ariaLabel="Due time" format="12h" onValidityChange={onValidityChange} />
          <button type="button" className="task-dialog-close" aria-label="Remove due time" onClick={() => { onTimeChange(null); onValidityChange(true) }}><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
