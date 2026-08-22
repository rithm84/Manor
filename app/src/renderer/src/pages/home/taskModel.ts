/**
 * Home-page task helpers: date math on the mock calendar, bucket derivation,
 * chip colorways, and the option lists for the property editors.
 * Data source: ../../data/mock.ts (canonical; read-only).
 */

import { NOW_TIME, TODAY_ISO, events } from '../../data/mock'
import type {
  Task,
  TaskBucket,
  TaskContext,
  TaskDifficulty,
  TaskPriority,
  TaskStatus
} from '../../data/mock'
import type { PillColorway } from '../../components/ui'

// ---------------------------------------------------------------------------
// Dates (ISO "YYYY-MM-DD", local time; the story's today is 2026-08-20)
// ---------------------------------------------------------------------------

export function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

export function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = parseIso(to).getTime() - parseIso(from).getTime()
  return Math.round(ms / 86_400_000)
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "Wed, Aug 20" */
export function formatDayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

/** "Aug 20" */
export function formatShortDate(iso: string): string {
  const date = parseIso(iso)
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`
}

// ---------------------------------------------------------------------------
// Times ("HH:MM" 24h)
// ---------------------------------------------------------------------------

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number(part))
  return hours * 60 + minutes
}

export function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** "2:00 PM" (minutes dropped on the hour: "2 PM" reads too terse in a grid). */
export function formatClock(time: string): string {
  const total = timeToMinutes(time)
  const hours24 = Math.floor(total / 60)
  const minutes = total % 60
  const meridiem = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(minutes).padStart(2, '0')} ${meridiem}`
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Where a due date lands on the board, relative to the story's today. */
export function bucketForDue(due: string): TaskBucket {
  const diff = daysBetween(TODAY_ISO, due)
  if (diff < 0) {
    return 'overdue'
  }
  if (diff === 0) {
    return 'today'
  }
  if (diff === 1) {
    return 'tomorrow'
  }
  return 'week'
}

/** Reconcile bucket + daysLate after a due-date change. */
export function withDue(task: Task, due: string): Task {
  const bucket = bucketForDue(due)
  return {
    ...task,
    due,
    bucket,
    daysLate: bucket === 'overdue' ? -daysBetween(TODAY_ISO, due) : 0
  }
}

/** Default due date when a task is created straight into a column. */
export function dueForBucket(bucket: TaskBucket): string {
  if (bucket === 'overdue') {
    return addDays(TODAY_ISO, -1)
  }
  if (bucket === 'today') {
    return TODAY_ISO
  }
  if (bucket === 'tomorrow') {
    return addDays(TODAY_ISO, 1)
  }
  return addDays(TODAY_ISO, 3)
}

// ---------------------------------------------------------------------------
// Chip colorways
// ---------------------------------------------------------------------------

export const CONTEXT_COLORWAY: Record<TaskContext, PillColorway> = {
  Uni: 'forest',
  Personal: 'success',
  Leetcode: 'gold',
  Apps: 'coral',
  Hackathons: 'week'
}

export const PRIORITY_COLORWAY: Record<TaskPriority, PillColorway> = {
  High: 'overdue',
  Medium: 'today',
  Low: 'neutral'
}

// ---------------------------------------------------------------------------
// Property options
// ---------------------------------------------------------------------------

export interface PropertyOption<T extends string> {
  value: T
  label: string
}

export const STATUS_OPTIONS: readonly PropertyOption<TaskStatus>[] = [
  { value: 'Not started', label: 'Not started' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Done', label: 'Done' }
]

export const CONTEXT_OPTIONS: readonly PropertyOption<TaskContext>[] = [
  { value: 'Uni', label: 'Uni' },
  { value: 'Personal', label: 'Personal' },
  { value: 'Leetcode', label: 'Leetcode' },
  { value: 'Apps', label: 'Apps' },
  { value: 'Hackathons', label: 'Hackathons' }
]

export const DIFFICULTY_OPTIONS: readonly PropertyOption<TaskDifficulty>[] = [
  { value: '<30min', label: '<30min' },
  { value: '<2hrs', label: '<2hrs' },
  { value: '<3hrs', label: '<3hrs' },
  { value: '>4hrs', label: '>4hrs' }
]

export const PRIORITY_OPTIONS: readonly PropertyOption<TaskPriority>[] = [
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' }
]

/** Minutes a dropped task should block on the Today panel. */
export function blockMinutesFor(difficulty: TaskDifficulty | null): number {
  if (difficulty === '<30min') {
    return 30
  }
  if (difficulty === '<3hrs') {
    return 90
  }
  if (difficulty === '>4hrs') {
    return 120
  }
  return 60
}

// ---------------------------------------------------------------------------
// Provenance (mock: Alfred created the Neetcode task, per the audit log)
// ---------------------------------------------------------------------------

const ALFRED_CREATED: Record<string, string> = {
  'task-neetcode-two-pointers': 'Aug 18'
}

export interface TaskProvenance {
  byAlfred: boolean
  line: string
}

export function provenanceFor(task: Task): TaskProvenance {
  const alfredDate = ALFRED_CREATED[task.id]
  if (alfredDate !== undefined) {
    return { byAlfred: true, line: `Alfred created this · ${alfredDate}` }
  }
  return { byAlfred: false, line: 'You created this' }
}

/** Drag payload type for board card → Today panel. */
export const TASK_DRAG_TYPE = 'application/x-manor-task'

// ---------------------------------------------------------------------------
// Today's free time (shared by the drop handler and the timeline hint slot)
// ---------------------------------------------------------------------------

/** A locally created time block on the Today timeline. */
export interface DroppedBlock {
  id: string
  taskId: string
  title: string
  start: string
  end: string
}

interface BusySpan {
  start: number
  end: number
}

/** First gap after now that fits `minutes`, skipping today's busy spans. */
export function findFreeStart(minutes: number, dropped: readonly DroppedBlock[]): string {
  const busy: BusySpan[] = [
    ...events
      .filter((event) => event.date === TODAY_ISO)
      .map((event) => ({ start: timeToMinutes(event.start), end: timeToMinutes(event.end) })),
    ...dropped.map((block) => ({
      start: timeToMinutes(block.start),
      end: timeToMinutes(block.end)
    }))
  ].sort((a, b) => a.start - b.start)

  let candidate = Math.ceil(timeToMinutes(NOW_TIME) / 30) * 30
  for (const span of busy) {
    if (span.end <= candidate) {
      continue
    }
    if (candidate + minutes <= span.start) {
      break
    }
    candidate = span.end
  }
  return minutesToTime(candidate)
}
