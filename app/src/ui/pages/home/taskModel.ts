import type { PillColorway } from '../../components/ui'
import type {
  CalendarEvent,
  ContextDefinition,
  ScratchBlock,
  Task,
  TaskBucket,
  TaskEstimateMinutes,
  TaskPriority,
  TaskStatus
} from '../../data/mock'

export function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

export function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function localTodayIso(now: Date): string {
  return toIso(now)
}

export function localTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000)
}

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
] as const

export function formatDayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

export function formatLongDayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${WEEKDAYS_LONG[date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`
}

export function formatShortDate(iso: string): string {
  const date = parseIso(iso)
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

const TIME_PATTERN = /^\d{2}:\d{2}$/

/** True for a complete HH:MM string; a half-typed time input is not. */
export function isTimeString(value: string): boolean {
  return TIME_PATTERN.test(value)
}

export function timeToMinutes(time: string): number {
  if (!isTimeString(time)) {
    throw new TypeError(`Time "${time}" is not an HH:MM string`)
  }
  const [hours, minutes] = time.split(':').map((part) => Number(part))
  return hours * 60 + minutes
}

export function minutesToTime(total: number): string {
  const normalized = Math.max(0, Math.min(24 * 60, total))
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatClock(time: string): string {
  const total = timeToMinutes(time)
  const hours24 = Math.floor(total / 60) % 24
  const minutes = total % 60
  const meridiem = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes).padStart(2, '0')} ${meridiem}`
}

export function bucketForDue(due: string, today: string): TaskBucket | null {
  const diff = daysBetween(today, due)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff <= 7) return 'week'
  return null
}

/** Board drops reschedule between exact days; a This Week target instead
    hands off to the detail dialog for an exact date. */
export function canDropTaskOnBucket(source: TaskBucket, target: TaskBucket): boolean {
  if (target === 'week') return source !== 'week'
  if (target === 'today') return source === 'overdue' || source === 'tomorrow'
  if (target === 'tomorrow') return source === 'overdue' || source === 'today'
  return false
}

export function dueForBucket(bucket: TaskBucket, today: string): string {
  if (bucket === 'overdue') return addDays(today, -1)
  if (bucket === 'today') return today
  if (bucket === 'tomorrow') return addDays(today, 1)
  return addDays(today, 2)
}

export interface TaskCreationDefaults {
  context: null
  due: string | null
}

/** Values collected by the creation dialog before a task exists. */
export interface DraftTask {
  title: string
  context: string | null
  due: string | null
  estimateMinutes: TaskEstimateMinutes | null
  priority: TaskPriority | null
}

export function canCreateTaskInBucket(bucket: TaskBucket): boolean {
  return bucket !== 'overdue'
}

/** The bucket only seeds the dialog's due date; This Week starts unset. */
export function taskCreationDefaults(bucket: TaskBucket, today: string): TaskCreationDefaults {
  if (bucket === 'today') return { context: null, due: today }
  if (bucket === 'tomorrow') return { context: null, due: addDays(today, 1) }
  return { context: null, due: null }
}

/** An explicit due picked in the dialog always wins over the bucket default. */
export function dueForTaskCreation(
  bucket: TaskBucket,
  today: string,
  selectedDue: string | null
): string {
  if (!canCreateTaskInBucket(bucket)) {
    throw new RangeError('Overdue tasks cannot be created')
  }
  if (selectedDue !== null) return selectedDue
  const fallback = taskCreationDefaults(bucket, today).due
  if (fallback === null) {
    throw new RangeError('This Week tasks require an exact due date')
  }
  return fallback
}

export function daysLate(task: Task, today: string): number {
  return Math.max(0, -daysBetween(today, task.due))
}

export function contextDefinitionFor(
  contextName: string,
  contexts: readonly ContextDefinition[]
): ContextDefinition {
  const context = contexts.find((candidate) => candidate.name === contextName)
  if (context === undefined) {
    throw new Error(`Task context ${contextName} has no persisted presentation definition`)
  }
  return context
}

export const PRIORITY_COLORWAY: Record<TaskPriority, PillColorway> = {
  Low: 'neutral',
  Medium: 'today',
  High: 'overdue'
}

export const STATUS_COLORWAY: Record<TaskStatus, PillColorway> = {
  'Not started': 'neutral',
  'In Progress': 'info',
  Done: 'success'
}

export const ESTIMATE_COLORWAY: Record<TaskEstimateMinutes, PillColorway> = {
  15: 'success',
  30: 'forest',
  60: 'info',
  120: 'gold',
  180: 'plum',
  240: 'overdue'
}

export interface PropertyOption<T extends string | number> {
  value: T
  label: string
  tone?: PillColorway
}

export const STATUS_OPTIONS: readonly PropertyOption<TaskStatus>[] = [
  { value: 'Not started', label: 'Not started', tone: STATUS_COLORWAY['Not started'] },
  { value: 'In Progress', label: 'In progress', tone: STATUS_COLORWAY['In Progress'] },
  { value: 'Done', label: 'Done', tone: STATUS_COLORWAY.Done }
]

export const ESTIMATE_OPTIONS: readonly PropertyOption<TaskEstimateMinutes>[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4+ hours' }
]

export const ESTIMATE_SELECT_OPTIONS = ESTIMATE_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
  tone: ESTIMATE_COLORWAY[option.value]
}))

export const PRIORITY_OPTIONS: readonly PropertyOption<TaskPriority>[] = [
  { value: 'Low', label: 'Low', tone: PRIORITY_COLORWAY.Low },
  { value: 'Medium', label: 'Medium', tone: PRIORITY_COLORWAY.Medium },
  { value: 'High', label: 'High', tone: PRIORITY_COLORWAY.High }
]

const PRIORITY_ORDER: Readonly<Record<TaskPriority, number>> = {
  High: 0,
  Medium: 1,
  Low: 2
}

export function compareWeeklyTasks(left: Task, right: Task): number {
  const dueOrder = left.due.localeCompare(right.due)
  if (dueOrder !== 0) return dueOrder
  const leftPriority = left.priority === null ? 3 : PRIORITY_ORDER[left.priority]
  const rightPriority = right.priority === null ? 3 : PRIORITY_ORDER[right.priority]
  return leftPriority - rightPriority || left.title.localeCompare(right.title)
}

export function dueColorway(due: string, today: string): PillColorway {
  return bucketForDue(due, today) ?? 'neutral'
}

export function estimateLabel(estimate: TaskEstimateMinutes): string {
  const option = ESTIMATE_OPTIONS.find((candidate) => candidate.value === estimate)
  if (option === undefined) {
    throw new Error(`No label exists for the ${estimate}-minute estimate`)
  }
  return option.label
}

export function blockMinutesFor(estimate: TaskEstimateMinutes | null): number {
  return estimate ?? 60
}

const CODEX_CREATED: Readonly<Record<string, string>> = {
  'task-neetcode-two-pointers': 'Aug 18'
}

export interface TaskProvenance {
  byCodex: boolean
  line: string
}

export function provenanceFor(task: Task): TaskProvenance {
  const codexDate = CODEX_CREATED[task.id]
  return codexDate !== undefined
    ? { byCodex: true, line: `Codex created this · ${codexDate}` }
    : { byCodex: false, line: 'You created this' }
}

export const TASK_DRAG_TYPE = 'application/x-manor-task'

interface BusySpan {
  start: number
  end: number
}

export function findFreeStart(
  date: string,
  minutes: number,
  afterMinutes: number,
  scratchBlocks: readonly ScratchBlock[],
  /** Calendar events treated as busy time; pass the demo story only when
      signed out, so real accounts never schedule around phantom meetings. */
  busyEvents: readonly CalendarEvent[]
): string {
  const busy: BusySpan[] = [
    ...busyEvents
      .filter((event) => event.date === date && !event.scratch)
      .map((event) => ({ start: timeToMinutes(event.start), end: timeToMinutes(event.end) })),
    ...scratchBlocks
      .filter((block) => block.date === date)
      .map((block) => ({ start: timeToMinutes(block.start), end: timeToMinutes(block.end) }))
  ].sort((a, b) => a.start - b.start)

  let candidate = Math.ceil(afterMinutes / 15) * 15
  for (const span of busy) {
    if (span.end <= candidate) continue
    if (candidate + minutes <= span.start) break
    candidate = span.end
  }
  if (candidate + minutes > 24 * 60) {
    throw new RangeError('No free slot before midnight fits this task')
  }
  return minutesToTime(candidate)
}

export function scratchExpiry(date: string, end: string): string {
  const scheduledEnd = parseIso(date)
  scheduledEnd.setMinutes(timeToMinutes(end))
  scheduledEnd.setHours(scheduledEnd.getHours() + 48)
  return scheduledEnd.toISOString()
}

export function defaultPortion(blockMinutes: number, estimateMinutes: number | null): string {
  if (estimateMinutes === null || blockMinutes >= estimateMinutes) {
    return 'full task'
  }
  return `first ${blockMinutes} min`
}
