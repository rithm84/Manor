import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Select } from '../../components/ui'
import { DueDatePicker } from './DueDatePicker'
import { parseRecurrence, recurrenceLabel, serializeRecurrence } from '../../../shared/recurrence'
import type { RecurrenceRule, RecurrenceUnit } from '../../../shared/recurrence'

export interface RecurrenceEditorProps {
  /** RFC 5545 recurrence rule; null when the task does not repeat. */
  value: string | null
  onChange: (value: string | null) => void
}

const PRESETS: readonly { label: string; value: string | null }[] = [
  { label: "Doesn't repeat", value: null },
  { label: 'Every day', value: 'FREQ=DAILY;INTERVAL=1' },
  { label: 'Every week', value: 'FREQ=WEEKLY;INTERVAL=1' },
  { label: 'Every Sunday', value: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU' }
]

const UNIT_OPTIONS = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' }
] as const

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const DEFAULT_RULE: RecurrenceRule = { every: 2, unit: 'week', weekdays: ['Sun'], until: null }

const MIN_INTERVAL = 1
const MAX_INTERVAL = 30

/** Repeats retain exact weekdays, interval, and end date in their persisted rule. */
export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps): ReactNode {
  const presetValues = PRESETS.map((preset) => preset.value)
  const startsCustom = value !== null && !presetValues.includes(value)
  const [customOpen, setCustomOpen] = useState(startsCustom)
  const [rule, setRule] = useState<RecurrenceRule>(
    () => (value === null || !value.startsWith('FREQ=') ? null : parseRecurrence(value)) ?? DEFAULT_RULE
  )
  // Raw text so the interval field can be cleared while retyping; it is
  // clamped and committed on blur, not per keystroke.
  const [everyText, setEveryText] = useState(String(rule.every))

  const applyRule = (next: RecurrenceRule): void => {
    setRule(next)
    onChange(serializeRecurrence(next))
  }

  const commitInterval = (): void => {
    const parsed = Number(everyText)
    const every = Number.isInteger(parsed) && parsed !== 0
      ? Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, parsed))
      : rule.every
    setEveryText(String(every))
    if (every !== rule.every) applyRule({ ...rule, every })
  }

  const onIntervalKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  const openCustom = (): void => {
    // Show the saved custom rule instead of the default; commit nothing
    // until the user actually changes something.
    const saved = value === null || !value.startsWith('FREQ=') ? null : parseRecurrence(value)
    const next = saved ?? DEFAULT_RULE
    setRule(next)
    setEveryText(String(next.every))
    setCustomOpen(true)
  }

  const toggleWeekday = (day: string): void => {
    const has = rule.weekdays.includes(day)
    const weekdays = has
      ? rule.weekdays.filter((existing) => existing !== day)
      : WEEKDAYS.filter((candidate) => rule.weekdays.includes(candidate) || candidate === day)
    applyRule({ ...rule, weekdays })
  }

  return (
    <div className="recur">
      <div className="recur-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`recur-chip${!customOpen && value === preset.value ? ' is-active' : ''}`}
            onClick={() => {
              setCustomOpen(false)
              onChange(preset.value)
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={`recur-chip${customOpen ? ' is-active' : ''}`}
          onClick={openCustom}
        >
          Custom
        </button>
      </div>

      {customOpen ? (
        <div className="recur-custom">
          <div className="recur-row">
            <span className="recur-word">Every</span>
            <input
              type="number"
              min={MIN_INTERVAL}
              max={MAX_INTERVAL}
              className="recur-count tnum"
              value={everyText}
              aria-label="Repeat interval"
              onChange={(event) => setEveryText(event.target.value)}
              onBlur={commitInterval}
              onKeyDown={onIntervalKeyDown}
            />
            <Select
              value={rule.unit}
              options={UNIT_OPTIONS}
              onChange={(unit) => applyRule({ ...rule, unit: unit as RecurrenceUnit })}
              placeholder="Unit"
              ariaLabel="Repeat unit"
            />
          </div>
          {rule.unit === 'week' ? (
            <div className="recur-row">
              <span className="recur-word">On</span>
              <span className="recur-days">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`recur-day${rule.weekdays.includes(day) ? ' is-active' : ''}`}
                    aria-pressed={rule.weekdays.includes(day)}
                    onClick={() => toggleWeekday(day)}
                  >
                    {day.slice(0, 2)}
                  </button>
                ))}
              </span>
            </div>
          ) : null}
          <div className="recur-row">
            <span className="recur-word">Until</span>
            <DueDatePicker
              value={rule.until}
              onChange={(until) => applyRule({ ...rule, until })}
              ariaLabel="Repeat until"
              min={null}
              max={null}
            />
          </div>
          <div className="recur-summary">{recurrenceLabel(serializeRecurrence(rule))}</div>
        </div>
      ) : null}
    </div>
  )
}
