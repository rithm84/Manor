/* Dispatches Alfred's Realtime function calls onto the typed window.manor
   surface. Pure dependency-injected core (testable without a browser) plus a
   renderer binding. Enforces the authority rules: the Journal is unreachable,
   and destructive tools run only after a spoken confirm-back round trip. */

import type { AlfredRoute } from '../../../shared/alfred'
import type {
  AlfredAuditDraft,
  AlfredCloudApi
} from '../../../shared/alfredVoice'
import { ALFRED_NAVIGABLE_ROUTES, toolDefinitionOf } from '../../../shared/alfredVoice'
import type { HabitLogMutation, HabitsState } from '../../../shared/habits'
import type { HomeState, ScratchBlock, Task } from '../../../shared/home'
import type { AddLeetCodeAttemptMutation, LeetCodeState } from '../../../shared/leetcode'
import type {
  Focus,
  FocusMutation,
  Mood,
  MoodFocusNoteMutation,
  MoodFocusState,
  MoodMutation
} from '../../../shared/moodFocus'
import { FOCUS_SCALE, MOOD_SCALE } from '../../../shared/moodFocus'
import { createHabitSeed } from '../pages/habits/habitSeed'
import { createHomeSeed } from '../pages/home/homeSeed'
import { LEETCODE_SEED } from '../pages/leetcode/leetCodeSeed'
import { createMoodFocusSeed } from '../pages/moodfocus/moodFocusSeed'

export interface AlfredToolCall {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export interface AlfredToolResult {
  callId: string
  output: Record<string, unknown>
  /** Non-null exactly when an action executed; the caller writes it to the audit trail. */
  audit: AlfredAuditDraft | null
}

export interface ToolExecutorDeps {
  loadHome: () => Promise<HomeState>
  upsertTask: (task: Task) => Promise<Task>
  deleteTask: (taskId: string) => Promise<void>
  upsertScratchBlock: (block: ScratchBlock) => Promise<ScratchBlock>
  loadHabits: () => Promise<HabitsState>
  setHabitEntry: (mutation: HabitLogMutation) => Promise<HabitsState>
  loadMoodFocus: () => Promise<MoodFocusState>
  setMood: (mutation: MoodMutation) => Promise<MoodFocusState>
  setFocus: (mutation: FocusMutation) => Promise<MoodFocusState>
  setDailyNote: (mutation: MoodFocusNoteMutation) => Promise<MoodFocusState>
  loadLeetCode: () => Promise<LeetCodeState>
  addLeetCodeAttempt: (mutation: AddLeetCodeAttemptMutation) => Promise<LeetCodeState>
  navigate: (route: AlfredRoute) => Promise<void>
  captureScreen: () => Promise<void>
  consult: AlfredCloudApi['consult']
  remember: AlfredCloudApi['remember']
  newId: () => string
}

export interface AlfredToolExecutor {
  execute: (call: AlfredToolCall) => Promise<AlfredToolResult>
}

const HABIT_VALUES = [0, 25, 50, 75, 100] as const
type HabitValue = (typeof HABIT_VALUES)[number]

const VOICE_SOLUTION_NOTE = 'Logged by voice with Alfred; no source pasted.'

/* ------------------------------------------------------------------------- */
/* Argument helpers                                                           */
/* ------------------------------------------------------------------------- */

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`The ${key} argument must be a non-empty string`)
  }
  return value.trim()
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`The ${key} argument must be a string when provided`)
  }
  return value.trim() === '' ? null : value.trim()
}

function habitValueArg(args: Record<string, unknown>): HabitValue {
  const raw = args.value
  const numeric = typeof raw === 'string' ? Number(raw) : raw
  if (typeof numeric !== 'number' || !HABIT_VALUES.includes(numeric as HabitValue)) {
    throw new Error('The value argument must be 0, 25, 50, 75, or 100')
  }
  return numeric as HabitValue
}

/* ------------------------------------------------------------------------- */
/* Matching and dates                                                         */
/* ------------------------------------------------------------------------- */

export function bestMatch<T>(
  items: readonly T[],
  textOf: (item: T) => string,
  query: string
): T | null {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return null
  let best: T | null = null
  let bestScore = 0
  for (const item of items) {
    const text = textOf(item).toLocaleLowerCase()
    let score = 0
    if (text === normalized) score = 4
    else if (text.startsWith(normalized)) score = 3
    else if (text.includes(normalized)) score = 2
    else {
      const tokens = normalized.split(/\s+/)
      if (tokens.length > 1 && tokens.every((token) => text.includes(token))) score = 1
    }
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}

export function localIsoDate(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDaysIso(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function dueDateOf(due: string, today: string): string {
  const normalized = due.trim().toLocaleLowerCase()
  if (normalized === 'today') return today
  if (normalized === 'tomorrow') return addDaysIso(today, 1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  throw new Error(`The due argument must be today, tomorrow, or YYYY-MM-DD, not "${due}"`)
}

function snapToQuarterHour(minutes: number): number {
  return Math.round(minutes / 15) * 15
}

function minutesOf(time: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  if (match === null) {
    throw new Error(`The start argument must be HH:MM on a 24 hour clock, not "${time}"`)
  }
  return Number(match[1]) * 60 + Number(match[2])
}

function timeOf(minutes: number): string {
  if (minutes >= 24 * 60) return '24:00'
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0')
  const rest = String(minutes % 60).padStart(2, '0')
  return `${hours}:${rest}`
}

/* ------------------------------------------------------------------------- */
/* Executor                                                                   */
/* ------------------------------------------------------------------------- */

function done(details: Record<string, unknown>): Record<string, unknown> {
  return { status: 'done', ...details }
}

export function createToolExecutor(deps: ToolExecutorDeps): AlfredToolExecutor {
  /* Destructive calls confirmed=true are honoured only when this executor
     previously answered needs_confirmation for the same target. */
  const pendingConfirmations = new Set<string>()

  async function dispatch(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ output: Record<string, unknown>; audit: AlfredAuditDraft | null }> {
    const today = localIsoDate(new Date())

    switch (name) {
      case 'log_habit': {
        const query = stringArg(args, 'habit')
        const value = habitValueArg(args)
        const habits = await deps.loadHabits()
        const habit =
          habits.habits.find((candidate) => candidate.id === query) ??
          bestMatch(habits.habits, (candidate) => candidate.name, query)
        if (habit === null || habit === undefined) {
          return { output: { status: 'error', message: `No habit matches "${query}"` }, audit: null }
        }
        await deps.setHabitEntry({ habitId: habit.id, date: habits.today, value })
        const summary = `Logged ${habit.name} at ${value}% for ${habits.today}`
        return {
          output: done({ habit: habit.name, value, date: habits.today }),
          audit: { kind: 'log_habit', summary, payload: { habitId: habit.id, value, date: habits.today } }
        }
      }

      case 'complete_task': {
        const query = stringArg(args, 'task')
        const home = await deps.loadHome()
        const open = home.tasks.filter((task) => task.status !== 'Done')
        const task =
          home.tasks.find((candidate) => candidate.id === query) ??
          bestMatch(open, (candidate) => candidate.title, query)
        if (task === null || task === undefined) {
          return { output: { status: 'error', message: `No task matches "${query}"` }, audit: null }
        }
        await deps.upsertTask({ ...task, status: 'Done' })
        return {
          output: done({ task: task.title }),
          audit: {
            kind: 'complete_task',
            summary: `Completed the task "${task.title}"`,
            payload: { taskId: task.id, title: task.title }
          }
        }
      }

      case 'create_task': {
        const title = stringArg(args, 'title')
        const due = dueDateOf(stringArg(args, 'due'), today)
        const contextQuery = optionalStringArg(args, 'context')
        const home = await deps.loadHome()
        const context =
          contextQuery === null
            ? home.contexts[0]
            : bestMatch(home.contexts, (candidate) => candidate.name, contextQuery)
        if (context === null || context === undefined) {
          return {
            output: {
              status: 'error',
              message:
                contextQuery === null
                  ? 'No task contexts exist yet; create one in Manor first'
                  : `No context matches "${contextQuery}"`
            },
            audit: null
          }
        }
        const task: Task = {
          id: deps.newId(),
          title,
          context: context.name,
          estimateMinutes: null,
          priority: null,
          status: 'Not started',
          due,
          tags: [],
          recurrence: null
        }
        const saved = await deps.upsertTask(task)
        return {
          output: done({ task: saved.title, due: saved.due, context: saved.context }),
          audit: {
            kind: 'create_task',
            summary: `Created the task "${title}" due ${due}`,
            payload: { taskId: saved.id, title, due, context: context.name }
          }
        }
      }

      case 'log_mood': {
        const mood = stringArg(args, 'mood')
        if (!MOOD_SCALE.includes(mood as Mood)) {
          return { output: { status: 'error', message: `"${mood}" is not a mood level` }, audit: null }
        }
        const state = await deps.loadMoodFocus()
        await deps.setMood({ date: state.today, mood: mood as Mood })
        return {
          output: done({ mood, date: state.today }),
          audit: {
            kind: 'log_mood',
            summary: `Logged mood ${mood} for ${state.today}`,
            payload: { mood, date: state.today }
          }
        }
      }

      case 'log_focus': {
        const focus = stringArg(args, 'focus')
        if (!FOCUS_SCALE.includes(focus as Focus)) {
          return {
            output: { status: 'error', message: `"${focus}" is not a focus level` },
            audit: null
          }
        }
        const state = await deps.loadMoodFocus()
        await deps.setFocus({ date: state.today, focus: focus as Focus })
        return {
          output: done({ focus, date: state.today }),
          audit: {
            kind: 'log_focus',
            summary: `Logged focus ${focus} for ${state.today}`,
            payload: { focus, date: state.today }
          }
        }
      }

      case 'set_daily_note': {
        const note = stringArg(args, 'note')
        const state = await deps.loadMoodFocus()
        await deps.setDailyNote({ date: state.today, note, source: 'alfred' })
        return {
          output: done({ date: state.today }),
          audit: {
            kind: 'set_daily_note',
            summary: `Attached a debrief note to ${state.today}`,
            payload: { date: state.today, note }
          }
        }
      }

      case 'add_leetcode_attempt': {
        const query = stringArg(args, 'problem')
        const solution = optionalStringArg(args, 'solution') ?? VOICE_SOLUTION_NOTE
        const state = await deps.loadLeetCode()
        const problem =
          state.problems.find((candidate) => candidate.id === query) ??
          bestMatch(state.problems, (candidate) => candidate.name, query)
        if (problem === null || problem === undefined) {
          return {
            output: { status: 'error', message: `No LeetCode problem matches "${query}"` },
            audit: null
          }
        }
        await deps.addLeetCodeAttempt({ problemId: problem.id, date: today, solution })
        return {
          output: done({ problem: problem.name, date: today }),
          audit: {
            kind: 'add_leetcode_attempt',
            summary: `Logged a LeetCode attempt on ${problem.name}`,
            payload: { problemId: problem.id, problem: problem.name, date: today }
          }
        }
      }

      case 'create_sticky': {
        const title = stringArg(args, 'title')
        const rawDuration = args.durationMinutes
        if (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration <= 0) {
          throw new Error('The durationMinutes argument must be a positive number')
        }
        const startMinutes = snapToQuarterHour(minutesOf(stringArg(args, 'start')))
        const duration = Math.max(15, snapToQuarterHour(rawDuration))
        const endMinutes = Math.min(24 * 60, startMinutes + duration)
        if (endMinutes <= startMinutes) {
          throw new Error('The sticky must end after it starts')
        }
        const start = timeOf(startMinutes)
        const end = timeOf(endMinutes)
        const endInstant = new Date(`${today}T00:00:00`)
        endInstant.setMinutes(endInstant.getMinutes() + endMinutes)
        const block: ScratchBlock = {
          id: deps.newId(),
          taskId: null,
          date: today,
          start,
          end,
          portion: title,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(endInstant.getTime() + 48 * 60 * 60 * 1000).toISOString()
        }
        const saved = await deps.upsertScratchBlock(block)
        return {
          output: done({ title, date: today, start, end }),
          audit: {
            kind: 'create_sticky',
            summary: `Placed "${title}" on the Today timeline at ${start}`,
            payload: { blockId: saved.id, title, date: today, start, end }
          }
        }
      }

      case 'navigate': {
        const route = stringArg(args, 'route')
        const target = ALFRED_NAVIGABLE_ROUTES.find((candidate) => candidate === route)
        if (target === undefined) {
          return {
            output: {
              status: 'error',
              message:
                route === '/journal'
                  ? 'The Journal stays closed to Alfred'
                  : `"${route}" is not a Manor page`
            },
            audit: null
          }
        }
        await deps.navigate(target)
        return {
          output: done({ route: target }),
          audit: {
            kind: 'navigate',
            summary: `Opened ${target}`,
            payload: { route: target }
          }
        }
      }

      case 'capture_screen': {
        await deps.captureScreen()
        return {
          output: done({}),
          audit: {
            kind: 'capture_screen',
            summary: 'Captured the screen into the knowledge base',
            payload: {}
          }
        }
      }

      case 'consult': {
        const question = stringArg(args, 'question')
        const answer = await deps.consult({ question, context: null })
        return {
          output: done({ answer }),
          audit: {
            kind: 'consult',
            summary: 'Consulted the supervisor',
            payload: { question }
          }
        }
      }

      case 'remember': {
        const fact = stringArg(args, 'fact')
        await deps.remember(fact)
        return {
          output: done({}),
          audit: {
            kind: 'remember',
            summary: 'Stored a fact for future sessions',
            payload: { fact }
          }
        }
      }

      case 'delete_task': {
        const query = stringArg(args, 'task')
        const home = await deps.loadHome()
        const task =
          home.tasks.find((candidate) => candidate.id === query) ??
          bestMatch(home.tasks, (candidate) => candidate.title, query)
        if (task === null || task === undefined) {
          return { output: { status: 'error', message: `No task matches "${query}"` }, audit: null }
        }
        const pendingKey = `delete_task:${task.id}`
        if (args.confirmed !== true || !pendingConfirmations.has(pendingKey)) {
          pendingConfirmations.add(pendingKey)
          return {
            output: {
              status: 'needs_confirmation',
              message:
                `Deleting is permanent. Ask the user to confirm deleting the task ` +
                `"${task.title}", and call this tool again with confirmed true only ` +
                'after a clear yes.'
            },
            audit: null
          }
        }
        pendingConfirmations.delete(pendingKey)
        await deps.deleteTask(task.id)
        return {
          output: done({ task: task.title }),
          audit: {
            kind: 'delete_task',
            summary: `Deleted the task "${task.title}" after a spoken confirmation`,
            payload: { taskId: task.id, title: task.title, confirmed: true }
          }
        }
      }

      default:
        return { output: { status: 'error', message: `Unknown tool "${name}"` }, audit: null }
    }
  }

  return {
    execute: async (call: AlfredToolCall): Promise<AlfredToolResult> => {
      if (toolDefinitionOf(call.name) === null) {
        return {
          callId: call.callId,
          output: { status: 'error', message: `Unknown tool "${call.name}"` },
          audit: null
        }
      }
      try {
        const { output, audit } = await dispatch(call.name, call.arguments)
        return { callId: call.callId, output, audit }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The action failed'
        return { callId: call.callId, output: { status: 'error', message }, audit: null }
      }
    }
  }
}

/** Binds the executor to the live window.manor surface plus the mock seeds. */
export function rendererToolExecutorDeps(cloud: AlfredCloudApi): ToolExecutorDeps {
  return {
    loadHome: () => window.manor.home.load(createHomeSeed()),
    upsertTask: (task) => window.manor.home.upsertTask(task),
    deleteTask: (taskId) => window.manor.home.deleteTask(taskId),
    upsertScratchBlock: (block) => window.manor.home.upsertScratchBlock(block),
    loadHabits: () => window.manor.habits.load(createHabitSeed()),
    setHabitEntry: (mutation) => window.manor.habits.setEntry(mutation),
    loadMoodFocus: () => window.manor.moodFocus.load(createMoodFocusSeed()),
    setMood: (mutation) => window.manor.moodFocus.setMood(mutation),
    setFocus: (mutation) => window.manor.moodFocus.setFocus(mutation),
    setDailyNote: (mutation) => window.manor.moodFocus.setNote(mutation),
    loadLeetCode: () => window.manor.leetcode.load(LEETCODE_SEED),
    addLeetCodeAttempt: (mutation) => window.manor.leetcode.addAttempt(mutation),
    navigate: (route) => window.manor.alfred.navigate(route),
    captureScreen: async (): Promise<void> => {
      await window.manor.capture.captureToKnowledgeBase()
    },
    consult: (query) => cloud.consult(query),
    remember: (fact) => cloud.remember(fact),
    newId: () => crypto.randomUUID()
  }
}
