import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { Select } from '../../components/ui'
import { DueDatePicker } from './DueDatePicker'
import { MONTHS_SHORT, formatShortDate, localTodayIso, parseIso, toIso } from './taskModel'

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

const MIN_INTERVAL = 1
const MAX_INTERVAL = 30

function summarize(rule: CustomRule): string {
  const unitText =
    rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`
  const days =
    rule.unit === 'week' && rule.weekdays.length > 0 ? ` on ${rule.weekdays.join(', ')}` : ''
  const until = rule.until !== null ? ` until ${formatShortDate(rule.until)}` : ''
  return `Every ${unitText}${days}${until}`
}

const RULE_PATTERN =
  /^Every (?:(\d+) )?(day|week|month)s?(?: on ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:, (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*))?(?: until ([A-Z][a-z]{2}) (\d{1,2}))?$/

/** Inverse of summarize. The summary drops the until year, so it is read
    back as the next occurrence on or after today. Null for non-custom text. */
function parseRule(value: string, today: string): CustomRule | null {
  const match = RULE_PATTERN.exec(value)
  if (match === null) return null
  const [, countText, unit, daysText, untilMonth, untilDay] = match
  let until: string | null = null
  if (untilMonth !== undefined && untilDay !== undefined) {
    const month = (MONTHS_SHORT as readonly string[]).indexOf(untilMonth)
    if (month === -1) return null
    const year = parseIso(today).getFullYear()
    const sameYear = toIso(new Date(year, month, Number(untilDay)))
    until = sameYear < today ? toIso(new Date(year + 1, month, Number(untilDay))) : sameYear
  }
  return {
    every: countText === undefined ? 1 : Number(countText),
    unit: unit as RecurrenceUnit,
    weekdays: daysText === undefined ? [] : daysText.split(', '),
    until
  }
}

/**
 * Recurrence property: preset chips plus a custom
 * "every [n] [unit] on [weekdays] until [date]" rule builder. Mock state;
 * the applied rule is stored as its human summary.
 */
export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps): ReactNode {
  const today = localTodayIso(new Date())
  const presetValues = PRESETS.map((preset) => preset.value)
  const startsCustom = value !== null && !presetValues.includes(value)
  const [customOpen, setCustomOpen] = useState(startsCustom)
  const [rule, setRule] = useState<CustomRule>(
    () => (value === null ? null : parseRule(value, today)) ?? DEFAULT_RULE
  )
  // Raw text so the interval field can be cleared while retyping; it is
  // clamped and committed on blur, not per keystroke.
  const [everyText, setEveryText] = useState(String(rule.every))

  const applyRule = (next: CustomRule): void => {
    setRule(next)
    onChange(summarize(next))
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
    const saved = value === null ? null : parseRule(value, today)
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
          <div className="recur-summary">{summarize(rule)}</div>
        </div>
      ) : null}
    </div>
  )
}
