import type { ReactNode } from 'react'
import { DatePicker } from '../../components/ui'

export interface DueDatePickerProps {
  value: string | null
  onChange: (iso: string) => void
  ariaLabel: string
  min: string | null
  max: string | null
  today?: string
}

/** Task due dates are required; the shared picker omits its clear action. */
export function DueDatePicker({ value, onChange, ariaLabel, min, max, today }: DueDatePickerProps): ReactNode {
  return <DatePicker value={value} onChange={(iso) => {
    if (iso === null) throw new Error('A task due date cannot be cleared.')
    onChange(iso)
  }} ariaLabel={ariaLabel} min={min} max={max} today={today} showIcon={false} required />
}
