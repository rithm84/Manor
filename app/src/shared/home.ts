export type TaskPriority = 'Low' | 'Medium' | 'High'
export type TaskStatus = 'Not started' | 'In Progress' | 'Done'
export type TaskEstimateMinutes = 15 | 30 | 60 | 120 | 180 | 240
export type ContextColor = 'forest' | 'success' | 'gold' | 'info' | 'plum' | 'today'
export const CONTEXT_ICON_VALUES = [
  'book-open',
  'graduation-cap',
  'library',
  'notebook-tabs',
  'brain',
  'calculator',
  'briefcase',
  'laptop',
  'rocket',
  'presentation',
  'landmark',
  'badge-dollar-sign',
  'house',
  'heart',
  'users',
  'shopping-bag',
  'utensils',
  'car',
  'code',
  'terminal',
  'git-branch',
  'bug',
  'database',
  'cpu',
  'target',
  'trophy',
  'dumbbell',
  'activity',
  'flame',
  'mountain',
  'sparkles',
  'palette',
  'music',
  'camera',
  'plane',
  'globe'
] as const
export type ContextIcon = (typeof CONTEXT_ICON_VALUES)[number]
export type MasterFilterProperty = 'context' | 'status' | 'priority' | 'due'
export type DueFilterOperator = 'before' | 'on' | 'after' | 'within'

export type MasterFilterRule =
  | { id: string; property: 'context'; value: string }
  | { id: string; property: 'status'; value: TaskStatus }
  | { id: string; property: 'priority'; value: TaskPriority }
  | { id: string; property: 'due'; operator: Exclude<DueFilterOperator, 'within'>; date: string }
  | { id: string; property: 'due'; operator: 'within'; from: string; to: string }

export interface SavedTaskView {
  id: string
  name: string
  rules: readonly MasterFilterRule[]
}

export interface ContextDefinition {
  name: string
  color: ContextColor
  icon: ContextIcon
}

export type ContextDraft = ContextDefinition

export interface Task {
  id: string
  title: string
  context: string
  estimateMinutes: TaskEstimateMinutes | null
  priority: TaskPriority | null
  status: TaskStatus
  due: string
  tags: readonly string[]
  recurrence: string | null
}

export interface ScratchBlock {
  id: string
  taskId: string
  date: string
  start: string
  end: string
  portion: string
  createdAt: string
  expiresAt: string
}

export interface HomeState {
  tasks: readonly Task[]
  contexts: readonly ContextDefinition[]
  scratchBlocks: readonly ScratchBlock[]
  savedTaskViews: readonly SavedTaskView[]
}

export interface HomeSeed {
  tasks: readonly Task[]
  contexts: readonly ContextDefinition[]
  scratchBlocks: readonly ScratchBlock[]
  savedTaskViews: readonly SavedTaskView[]
}

export interface HomeApi {
  load: (seed: HomeSeed) => Promise<HomeState>
  upsertTask: (task: Task) => Promise<Task>
  deleteTask: (taskId: string) => Promise<void>
  addContext: (context: ContextDraft) => Promise<ContextDefinition>
  upsertScratchBlock: (block: ScratchBlock) => Promise<ScratchBlock>
  deleteScratchBlock: (blockId: string) => Promise<void>
  upsertSavedTaskView: (view: SavedTaskView) => Promise<SavedTaskView>
  deleteSavedTaskView: (viewId: string) => Promise<void>
}

const PRIORITIES: readonly TaskPriority[] = ['Low', 'Medium', 'High']
const STATUSES: readonly TaskStatus[] = ['Not started', 'In Progress', 'Done']
const ESTIMATES: readonly TaskEstimateMinutes[] = [15, 30, 60, 120, 180, 240]
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/

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

function isoDateValue(value: unknown, label: string): string {
  const iso = stringValue(value, label)
  if (!ISO_DATE_PATTERN.test(iso)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`)
  }
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new TypeError(`${label} must be a real calendar date`)
  }
  return iso
}

function timeValue(value: unknown, label: string): string {
  const time = stringValue(value, label)
  if (!TIME_PATTERN.test(time)) {
    throw new TypeError(`${label} must use 24-hour HH:MM format`)
  }
  return time
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`)
  }
  return value.map((entry, index) => stringValue(entry, `${label}[${index}]`))
}

function priorityValue(value: unknown): TaskPriority | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' || !PRIORITIES.includes(value as TaskPriority)) {
    throw new TypeError('task.priority must be Low, Medium, High, or null')
  }
  return value as TaskPriority
}

function statusValue(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as TaskStatus)) {
    throw new TypeError('task.status must be Not started, In Progress, or Done')
  }
  return value as TaskStatus
}

function estimateValue(value: unknown): TaskEstimateMinutes | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'number' || !ESTIMATES.includes(value as TaskEstimateMinutes)) {
    throw new TypeError('task.estimateMinutes must be 15, 30, 60, 120, 180, 240, or null')
  }
  return value as TaskEstimateMinutes
}

export function parseTask(value: unknown): Task {
  const task = recordValue(value, 'task')
  return {
    id: stringValue(task.id, 'task.id'),
    title: stringValue(task.title, 'task.title'),
    context: stringValue(task.context, 'task.context'),
    estimateMinutes: estimateValue(task.estimateMinutes),
    priority: priorityValue(task.priority),
    status: statusValue(task.status),
    due: isoDateValue(task.due, 'task.due'),
    tags: stringList(task.tags, 'task.tags'),
    recurrence: nullableString(task.recurrence, 'task.recurrence')
  }
}

export function parseScratchBlock(value: unknown): ScratchBlock {
  const block = recordValue(value, 'scratch block')
  const start = timeValue(block.start, 'scratchBlock.start')
  const end = timeValue(block.end, 'scratchBlock.end')
  if (start === '24:00') {
    throw new RangeError('scratchBlock.start must be before midnight')
  }
  if (end <= start) {
    throw new RangeError('scratchBlock.end must be later than scratchBlock.start')
  }
  return {
    id: stringValue(block.id, 'scratchBlock.id'),
    taskId: stringValue(block.taskId, 'scratchBlock.taskId'),
    date: isoDateValue(block.date, 'scratchBlock.date'),
    start,
    end,
    portion: stringValue(block.portion, 'scratchBlock.portion'),
    createdAt: timestampValue(block.createdAt, 'scratchBlock.createdAt'),
    expiresAt: timestampValue(block.expiresAt, 'scratchBlock.expiresAt')
  }
}

export function parseContext(value: unknown): string {
  const context = stringValue(value, 'context')
  if (context.length > 48) {
    throw new RangeError('context must be 48 characters or fewer')
  }
  return context
}

const CONTEXT_COLORS: readonly ContextColor[] = [
  'forest', 'success', 'gold', 'info', 'plum', 'today'
]
function contextColorValue(value: unknown): ContextColor {
  if (typeof value !== 'string' || !CONTEXT_COLORS.includes(value as ContextColor)) {
    throw new TypeError('context.color must be forest, success, gold, info, plum, or today')
  }
  return value as ContextColor
}

function contextIconValue(value: unknown): ContextIcon {
  if (typeof value !== 'string' || !CONTEXT_ICON_VALUES.includes(value as ContextIcon)) {
    throw new TypeError('context.icon must be a supported Lucide context icon')
  }
  return value as ContextIcon
}

export function parseContextDefinition(value: unknown): ContextDefinition {
  const context = recordValue(value, 'context')
  return {
    name: parseContext(context.name),
    color: contextColorValue(context.color),
    icon: contextIconValue(context.icon)
  }
}

function filterPropertyValue(value: unknown): MasterFilterProperty {
  if (
    value !== 'context' &&
    value !== 'status' &&
    value !== 'priority' &&
    value !== 'due'
  ) {
    throw new TypeError('filter property must be context, status, priority, or due')
  }
  return value
}

function dueOperatorValue(value: unknown): DueFilterOperator {
  if (value !== 'before' && value !== 'on' && value !== 'after' && value !== 'within') {
    throw new TypeError('due filter operator must be before, on, after, or within')
  }
  return value
}

export function parseMasterFilterRule(value: unknown): MasterFilterRule {
  const rule = recordValue(value, 'master filter rule')
  const id = stringValue(rule.id, 'masterFilterRule.id')
  const property = filterPropertyValue(rule.property)
  if (property === 'context') {
    return { id, property, value: parseContext(rule.value) }
  }
  if (property === 'status') {
    return { id, property, value: statusValue(rule.value) }
  }
  if (property === 'priority') {
    const priority = priorityValue(rule.value)
    if (priority === null) throw new TypeError('priority filter value cannot be null')
    return { id, property, value: priority }
  }
  const operator = dueOperatorValue(rule.operator)
  if (operator === 'within') {
    const from = isoDateValue(rule.from, 'masterFilterRule.from')
    const to = isoDateValue(rule.to, 'masterFilterRule.to')
    if (to < from) throw new RangeError('masterFilterRule.to must be on or after from')
    return { id, property, operator, from, to }
  }
  return {
    id,
    property,
    operator,
    date: isoDateValue(rule.date, 'masterFilterRule.date')
  }
}

export function parseSavedTaskView(value: unknown): SavedTaskView {
  const view = recordValue(value, 'saved task view')
  if (!Array.isArray(view.rules)) {
    throw new TypeError('savedTaskView.rules must be an array')
  }
  return {
    id: stringValue(view.id, 'savedTaskView.id'),
    name: stringValue(view.name, 'savedTaskView.name'),
    rules: view.rules.map(parseMasterFilterRule)
  }
}

export function parseHomeSeed(value: unknown): HomeSeed {
  const seed = recordValue(value, 'home seed')
  if (
    !Array.isArray(seed.tasks) ||
    !Array.isArray(seed.contexts) ||
    !Array.isArray(seed.scratchBlocks) ||
    !Array.isArray(seed.savedTaskViews)
  ) {
    throw new TypeError('home seed tasks, contexts, scratchBlocks, and savedTaskViews must be arrays')
  }
  return {
    tasks: seed.tasks.map(parseTask),
    contexts: seed.contexts.map(parseContextDefinition),
    scratchBlocks: seed.scratchBlocks.map(parseScratchBlock),
    savedTaskViews: seed.savedTaskViews.map(parseSavedTaskView)
  }
}
