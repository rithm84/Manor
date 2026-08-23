export type HabitKind = 'binary' | 'quantized'
export type HabitLifecycleStatus = 'active' | 'paused' | 'retired'
export type HabitDayMark =
  | 'complete'
  | 'partial'
  | 'frozen'
  | 'missed'
  | 'pending'
  | 'future'
  | 'paused'
  | 'inactive'

export interface HabitDefinition {
  id: string
  name: string
  kind: HabitKind
  targetLabel: string | null
  createdOn: string
  createdAt: string
}

export interface HabitLifecycleEvent {
  habitId: string
  date: string
  status: HabitLifecycleStatus
  createdAt: string
}

export interface HabitEntry {
  habitId: string
  date: string
  value: 25 | 50 | 75 | 100
  createdAt: string
  updatedAt: string
}

export interface HabitFreezeUsage {
  habitId: string
  date: string
}

export interface HabitFreezeGrant {
  date: string
}

export interface HabitMonthPool {
  month: string
  capacity: number
  earned: number
  spent: number
  balance: number
}

export interface HabitsState {
  today: string
  habits: readonly HabitDefinition[]
  lifecycle: readonly HabitLifecycleEvent[]
  entries: readonly HabitEntry[]
  freezes: readonly HabitFreezeUsage[]
  grants: readonly HabitFreezeGrant[]
  pools: readonly HabitMonthPool[]
}

export interface HabitSeed {
  today: string
  habits: readonly HabitDefinition[]
  lifecycle: readonly HabitLifecycleEvent[]
  entries: readonly HabitEntry[]
  freezes: readonly HabitFreezeUsage[]
  grants: readonly HabitFreezeGrant[]
  finalizedDays: readonly string[]
  monthCapacities: Readonly<Record<string, number>>
}

export interface HabitDraft {
  name: string
  kind: HabitKind
  targetLabel: string | null
}

export interface HabitLogMutation {
  habitId: string
  date: string
  value: 0 | 25 | 50 | 75 | 100
}

export interface HabitStatusMutation {
  habitId: string
  date: string
  status: HabitLifecycleStatus
}

export interface HabitsApi {
  load: (seed: HabitSeed) => Promise<HabitsState>
  createHabit: (draft: HabitDraft) => Promise<HabitsState>
  updateHabit: (habitId: string, draft: HabitDraft) => Promise<HabitsState>
  setEntry: (mutation: HabitLogMutation) => Promise<HabitsState>
  setStatus: (mutation: HabitStatusMutation) => Promise<HabitsState>
  deleteHabit: (habitId: string) => Promise<HabitsState>
}

export interface HabitMetrics {
  currentStreak: number
  bestStreak: number
  freezeFreeDays: number
  gold: boolean
  completedDays: number
  trackedDays: number
  completionRate: number
  earnBackUsedThisMonth: boolean
  earnBackProgress: 0 | 1
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-\d{2}$/
const ENTRY_VALUES = [25, 50, 75, 100] as const
const KINDS: readonly HabitKind[] = ['binary', 'quantized']
const STATUSES: readonly HabitLifecycleStatus[] = ['active', 'paused', 'retired']

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null
  }
  return stringValue(value, label)
}

export function parseIsoDate(value: unknown, label: string): string {
  const date = stringValue(value, label)
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`)
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`${label} must be a real calendar date`)
  }
  return date
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function kindValue(value: unknown): HabitKind {
  if (typeof value !== 'string' || !KINDS.includes(value as HabitKind)) {
    throw new TypeError('habit.kind must be binary or quantized')
  }
  return value as HabitKind
}

function statusValue(value: unknown): HabitLifecycleStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as HabitLifecycleStatus)) {
    throw new TypeError('habit lifecycle status must be active, paused, or retired')
  }
  return value as HabitLifecycleStatus
}

function entryValue(value: unknown, allowZero: boolean): 0 | 25 | 50 | 75 | 100 {
  if (allowZero && value === 0) {
    return 0
  }
  if (typeof value !== 'number' || !ENTRY_VALUES.includes(value as 25 | 50 | 75 | 100)) {
    throw new TypeError('habit entry value must be 0, 25, 50, 75, or 100')
  }
  return value as 25 | 50 | 75 | 100
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`)
  }
  return value
}

export function parseHabitDefinition(value: unknown): HabitDefinition {
  const habit = recordValue(value, 'habit')
  const name = stringValue(habit.name, 'habit.name')
  if (name.length > 80) {
    throw new RangeError('habit.name must be 80 characters or fewer')
  }
  const kind = kindValue(habit.kind)
  const targetLabel = nullableString(habit.targetLabel, 'habit.targetLabel')
  if (kind === 'binary' && targetLabel !== null) {
    throw new TypeError('binary habits cannot have a target label')
  }
  if (kind === 'quantized' && targetLabel === null) {
    throw new TypeError('quantized habits require a target label')
  }
  return {
    id: stringValue(habit.id, 'habit.id'),
    name,
    kind,
    targetLabel,
    createdOn: parseIsoDate(habit.createdOn, 'habit.createdOn'),
    createdAt: timestampValue(habit.createdAt, 'habit.createdAt')
  }
}

export function parseHabitDraft(value: unknown): HabitDraft {
  const draft = recordValue(value, 'habit draft')
  const name = stringValue(draft.name, 'habitDraft.name')
  if (name.length > 80) {
    throw new RangeError('habitDraft.name must be 80 characters or fewer')
  }
  const kind = kindValue(draft.kind)
  const targetLabel = nullableString(draft.targetLabel, 'habitDraft.targetLabel')
  if (kind === 'binary' && targetLabel !== null) {
    throw new TypeError('binary habit drafts cannot have a target label')
  }
  if (kind === 'quantized' && targetLabel === null) {
    throw new TypeError('quantized habit drafts require a target label')
  }
  return { name, kind, targetLabel }
}

export function parseHabitLifecycleEvent(value: unknown): HabitLifecycleEvent {
  const event = recordValue(value, 'habit lifecycle event')
  return {
    habitId: stringValue(event.habitId, 'lifecycle.habitId'),
    date: parseIsoDate(event.date, 'lifecycle.date'),
    status: statusValue(event.status),
    createdAt: timestampValue(event.createdAt, 'lifecycle.createdAt')
  }
}

export function parseHabitEntry(value: unknown): HabitEntry {
  const entry = recordValue(value, 'habit entry')
  return {
    habitId: stringValue(entry.habitId, 'entry.habitId'),
    date: parseIsoDate(entry.date, 'entry.date'),
    value: entryValue(entry.value, false) as HabitEntry['value'],
    createdAt: timestampValue(entry.createdAt, 'entry.createdAt'),
    updatedAt: timestampValue(entry.updatedAt, 'entry.updatedAt')
  }
}

export function parseHabitLogMutation(value: unknown): HabitLogMutation {
  const mutation = recordValue(value, 'habit log mutation')
  return {
    habitId: stringValue(mutation.habitId, 'mutation.habitId'),
    date: parseIsoDate(mutation.date, 'mutation.date'),
    value: entryValue(mutation.value, true)
  }
}

export function parseHabitStatusMutation(value: unknown): HabitStatusMutation {
  const mutation = recordValue(value, 'habit status mutation')
  return {
    habitId: stringValue(mutation.habitId, 'mutation.habitId'),
    date: parseIsoDate(mutation.date, 'mutation.date'),
    status: statusValue(mutation.status)
  }
}

export function parseHabitSeed(value: unknown): HabitSeed {
  const seed = recordValue(value, 'habit seed')
  if (
    !Array.isArray(seed.habits) ||
    !Array.isArray(seed.lifecycle) ||
    !Array.isArray(seed.entries) ||
    !Array.isArray(seed.freezes) ||
    !Array.isArray(seed.grants) ||
    !Array.isArray(seed.finalizedDays)
  ) {
    throw new TypeError('habit seed collections must be arrays')
  }
  const capacities = recordValue(seed.monthCapacities, 'habit seed monthCapacities')
  const monthCapacities: Record<string, number> = {}
  Object.entries(capacities).forEach(([month, capacity]) => {
    if (!MONTH_PATTERN.test(month)) {
      throw new TypeError('habit seed month capacity keys must use YYYY-MM format')
    }
    monthCapacities[month] = integerValue(capacity, `monthCapacities.${month}`)
  })
  return {
    today: parseIsoDate(seed.today, 'seed.today'),
    habits: seed.habits.map(parseHabitDefinition),
    lifecycle: seed.lifecycle.map(parseHabitLifecycleEvent),
    entries: seed.entries.map(parseHabitEntry),
    freezes: seed.freezes.map((raw) => {
      const usage = recordValue(raw, 'freeze usage')
      return {
        habitId: stringValue(usage.habitId, 'freeze.habitId'),
        date: parseIsoDate(usage.date, 'freeze.date')
      }
    }),
    grants: seed.grants.map((raw) => {
      const grant = recordValue(raw, 'freeze grant')
      return { date: parseIsoDate(grant.date, 'grant.date') }
    }),
    finalizedDays: seed.finalizedDays.map((day, index) =>
      parseIsoDate(day, `finalizedDays[${index}]`)
    ),
    monthCapacities
  }
}

export function addDays(date: string, amount: number): string {
  const parsed = new Date(`${parseIsoDate(date, 'date')}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return parsed.toISOString().slice(0, 10)
}

export function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${parseIsoDate(start, 'start')}T00:00:00.000Z`)
  const endMs = Date.parse(`${parseIsoDate(end, 'end')}T00:00:00.000Z`)
  return Math.round((endMs - startMs) / 86_400_000)
}

export function monthKey(date: string): string {
  return parseIsoDate(date, 'date').slice(0, 7)
}

export function statusOn(
  habitId: string,
  date: string,
  lifecycle: readonly HabitLifecycleEvent[]
): HabitLifecycleStatus | null {
  const events = lifecycle
    .filter((event) => event.habitId === habitId && event.date <= date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt))
  return events.at(-1)?.status ?? null
}

export function metricsForHabit(state: HabitsState, habit: HabitDefinition): HabitMetrics {
  const entries = new Map(
    state.entries.filter((entry) => entry.habitId === habit.id).map((entry) => [entry.date, entry.value])
  )
  const freezes = new Set(
    state.freezes.filter((freeze) => freeze.habitId === habit.id).map((freeze) => freeze.date)
  )
  let currentStreak = 0
  let bestStreak = 0
  let freezeFreeDays = 0
  let completedDays = 0
  let trackedDays = 0
  let brokenStreak = 0
  let brokenOn: string | null = null
  let earnBackProgress: 0 | 1 = 0
  const earnBackMonths = new Set<string>()

  for (let date = habit.createdOn; date <= state.today; date = addDays(date, 1)) {
    const status = statusOn(habit.id, date, state.lifecycle)
    if (status === null || status === 'paused' || status === 'retired') {
      continue
    }
    trackedDays += 1
    const complete = entries.get(date) === 100
    const frozen = freezes.has(date)
    if (complete) {
      completedDays += 1
      currentStreak += 1
      freezeFreeDays += 1
      if (brokenOn !== null && !earnBackMonths.has(monthKey(brokenOn))) {
        const elapsed = daysBetween(brokenOn, date)
        if (elapsed <= 2) {
          if (earnBackProgress === 1) {
            currentStreak = brokenStreak + 2
            earnBackMonths.add(monthKey(brokenOn))
            brokenOn = null
            brokenStreak = 0
            earnBackProgress = 0
          } else {
            earnBackProgress = 1
          }
        } else {
          brokenOn = null
          brokenStreak = 0
          earnBackProgress = 0
        }
      }
    } else if (frozen) {
      currentStreak += 1
      freezeFreeDays = 0
      brokenOn = null
      brokenStreak = 0
      earnBackProgress = 0
    } else if (date < state.today) {
      if (currentStreak > 0) {
        brokenStreak = currentStreak
        brokenOn = date
      }
      currentStreak = 0
      freezeFreeDays = 0
      earnBackProgress = 0
    }
    bestStreak = Math.max(bestStreak, currentStreak)
  }

  return {
    currentStreak,
    bestStreak,
    freezeFreeDays,
    gold: freezeFreeDays >= 7,
    completedDays,
    trackedDays,
    completionRate: trackedDays === 0 ? 0 : Math.round((completedDays / trackedDays) * 100),
    earnBackUsedThisMonth: earnBackMonths.has(monthKey(state.today)),
    earnBackProgress
  }
}

export function markForDate(
  state: HabitsState,
  habit: HabitDefinition,
  date: string
): HabitDayMark {
  if (date > state.today) {
    return 'future'
  }
  const status = statusOn(habit.id, date, state.lifecycle)
  if (status === null) {
    return 'inactive'
  }
  if (status === 'paused') {
    return 'paused'
  }
  if (status === 'retired') {
    return 'inactive'
  }
  const entry = state.entries.find((candidate) => candidate.habitId === habit.id && candidate.date === date)
  if (entry?.value === 100) {
    return 'complete'
  }
  if (entry !== undefined) {
    return 'partial'
  }
  if (state.freezes.some((freeze) => freeze.habitId === habit.id && freeze.date === date)) {
    return 'frozen'
  }
  return date === state.today ? 'pending' : 'missed'
}
