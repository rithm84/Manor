import { RRule } from 'rrule'

export type RecurrenceUnit = 'day' | 'week' | 'month'
export interface RecurrenceRule {
  every: number
  unit: RecurrenceUnit
  weekdays: readonly string[]
  until: string | null
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const FREQUENCIES = { day: RRule.DAILY, week: RRule.WEEKLY, month: RRule.MONTHLY } as const

export function serializeRecurrence(rule: RecurrenceRule): string {
  if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > 30) throw new RangeError('Repeat interval must be between 1 and 30')
  const byweekday = rule.weekdays.map((day) => {
    const index = DAYS.findIndex((candidate) => candidate === day)
    if (index === -1) throw new TypeError(`Unknown repeat weekday ${day}`)
    return index
  })
  return new RRule({ freq: FREQUENCIES[rule.unit], interval: rule.every,
    byweekday: rule.unit === 'week' && byweekday.length > 0 ? byweekday : null,
    until: rule.until === null ? null : new Date(`${rule.until}T23:59:59Z`) }, true).toString().replace(/^RRULE:/, '')
}

export function parseRecurrence(value: string): RecurrenceRule {
  const rule = RRule.fromString(value)
  const unit = (Object.entries(FREQUENCIES) as [RecurrenceUnit, number][]).find(([, frequency]) => frequency === rule.options.freq)?.[0]
  if (unit === undefined) throw new TypeError('Manor supports daily, weekly, and monthly task repeats')
  return { every: rule.options.interval, unit, weekdays: (rule.options.byweekday ?? []).map((day) => DAYS[day]), until: rule.options.until?.toISOString().slice(0, 10) ?? null }
}

export function recurrenceLabel(value: string): string {
  if (!value.startsWith('FREQ=') && !value.startsWith('RRULE:')) return value
  return RRule.fromString(value).toText()
}
