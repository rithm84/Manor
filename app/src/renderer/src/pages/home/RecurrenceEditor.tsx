import { useState } from 'react'
import type { ReactNode } from 'react'

import { Select } from '../../components/ui'
import { DueDatePicker } from './DueDatePicker'
import { formatShortDate } from './taskModel'

export interface RecurrenceEditorProps {
  /** Human summary, e.g. "Every Sunday"; null when the task does not repeat. */
  value: string | null
  onChange: (value: string | null) => void
}

type RecurrenceUnit = 'day' | 'week' | 'month'

interface CustomRule {
  every: number
  unit: RecurrenceUnit
  weekdays: readonly string[]
  until: string | null
}

const PRESETS: readonly { label: string; value: string | null }[] = [
  { label: "Doesn't repeat", value: null },
  { label: 'Every day', value: 'Every day' },
  { label: 'Every week', value: 'Every week' },
  { label: 'Every Sunday', value: 'Every Sunday' }
]

const UNIT_OPTIONS = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
  { value: 'month', label: 'months' }
] as const

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const DEFAULT_RULE: CustomRule = { every: 2, unit: 'week', weekdays: ['Sun'], until: null }

function summarize(rule: CustomRule): string {
  const unitText =
    rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`
  const days =
    rule.unit === 'week' && rule.weekdays.length > 0 ? ` on ${rule.weekdays.join(', ')}` : ''
  const until = rule.until !== null ? ` until ${formatShortDate(rule.until)}` : ''
  return `Every ${unitText}${days}${until}`
}

/**
 * Recurrence property: preset chips plus a custom
 * "every [n] [unit] on [weekdays] until [date]" rule builder. Mock state;
 * the applied rule is stored as its human summary.
 */
export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps): ReactNode {
  const presetValues = PRESETS.map((preset) => preset.value)
  const startsCustom = value !== null && !presetValues.includes(value)
  const [customOpen, setCustomOpen] = useState(startsCustom)
  const [rule, setRule] = useState<CustomRule>(DEFAULT_RULE)

  const applyRule = (next: CustomRule): void => {
    setRule(next)
    onChange(summarize(next))
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
          onClick={() => {
            setCustomOpen(true)
            onChange(summarize(rule))
          }}
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
              min={1}
              max={30}
              className="recur-count tnum"
              value={rule.every}
              aria-label="Repeat interval"
              onChange={(event) => {
                const parsed = Number(event.target.value)
                const every = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(30, parsed))
                applyRule({ ...rule, every })
              }}
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
          <div className="recur-summary">{summarize(rule)}</div>
        </div>
      ) : null}
    </div>
  )
}
