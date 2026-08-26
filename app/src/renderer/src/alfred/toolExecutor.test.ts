import { describe, expect, it, vi } from 'vitest'

import type { HabitsState } from '../../../shared/habits'
import type { HomeState, Task } from '../../../shared/home'
import type { LeetCodeState } from '../../../shared/leetcode'
import type { MoodFocusState } from '../../../shared/moodFocus'
import { bestMatch, createToolExecutor, localIsoDate } from './toolExecutor'
import type { ToolExecutorDeps } from './toolExecutor'

const TASKS: readonly Task[] = [
  {
    id: 'task-1',
    title: 'Finish the physics problem set',
    context: 'Uni',
    estimateMinutes: 60,
    priority: 'High',
    status: 'Not started',
    due: '2026-08-20',
    tags: [],
    recurrence: null
  },
  {
    id: 'task-2',
    title: 'Physics reading',
    context: 'Uni',
    estimateMinutes: null,
    priority: null,
    status: 'Done',
    due: '2026-08-19',
    tags: [],
    recurrence: null
  }
]

const HOME: HomeState = {
  tasks: TASKS,
  contexts: [
    { name: 'Uni', color: 'info', icon: 'graduation-cap' },
    { name: 'Personal', color: 'plum', icon: 'heart' }
  ],
  scratchBlocks: [],
  savedTaskViews: []
}

const HABITS: HabitsState = {
  today: '2026-08-20',
  habits: [
    {
      id: 'habit-1',
      name: 'Deep Reading',
      kind: 'quantized',
      targetLabel: '30 minutes',
      createdOn: '2026-07-01',
      createdAt: '2026-07-01T00:00:00.000Z'
    },
    {
      id: 'habit-2',
      name: 'Sleep by midnight',
      kind: 'binary',
      targetLabel: null,
      createdOn: '2026-07-01',
      createdAt: '2026-07-01T00:00:00.000Z'
    }
  ],
  lifecycle: [],
  entries: [],
  freezes: [],
  grants: [],
  pools: []
}

const MOOD_FOCUS: MoodFocusState = { today: '2026-08-20', entries: [] }

const LEETCODE: LeetCodeState = {
  problems: [
    {
      id: 'neetcode-1-1',
      topic: 'Arrays & Hashing',
      name: 'Two Sum',
      difficulty: 'Easy',
      curriculumOrder: 0
    }
  ],
  attempts: [],
  summary: { totalProblems: 1, streak: 0, freezesLeft: 5, freezesPerMonth: 5, legacyProgress: [] }
}

function fakeDeps(): ToolExecutorDeps & {
  deleteTask: ReturnType<typeof vi.fn>
  setHabitEntry: ReturnType<typeof vi.fn>
  upsertTask: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
} {
  return {
    loadHome: vi.fn(async () => HOME),
    upsertTask: vi.fn(async (task: Task) => task),
    deleteTask: vi.fn(async () => undefined),
    upsertScratchBlock: vi.fn(async (block) => block),
    loadHabits: vi.fn(async () => HABITS),
    setHabitEntry: vi.fn(async () => HABITS),
    loadMoodFocus: vi.fn(async () => MOOD_FOCUS),
    setMood: vi.fn(async () => MOOD_FOCUS),
    setFocus: vi.fn(async () => MOOD_FOCUS),
    setDailyNote: vi.fn(async () => MOOD_FOCUS),
    loadLeetCode: vi.fn(async () => LEETCODE),
    addLeetCodeAttempt: vi.fn(async () => LEETCODE),
    navigate: vi.fn(async () => undefined),
    captureScreen: vi.fn(async () => undefined),
    consult: vi.fn(async () => 'The answer.'),
    remember: vi.fn(async () => undefined),
    newId: () => 'generated-id'
  }
}

describe('the Alfred tool executor', () => {
  it('logs a habit by fuzzy name match against loaded state', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-1',
      name: 'log_habit',
      arguments: { habit: 'deep reading', value: '75' }
    })
    expect(deps.setHabitEntry).toHaveBeenCalledWith({
      habitId: 'habit-1',
      date: '2026-08-20',
      value: 75
    })
    expect(result.output.status).toBe('done')
    expect(result.audit?.kind).toBe('log_habit')
  })

  it('completes a task by title, preferring tasks that are not done', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-2',
      name: 'complete_task',
      arguments: { task: 'physics' }
    })
    expect(deps.upsertTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', status: 'Done' })
    )
    expect(result.audit?.kind).toBe('complete_task')
  })

  it('creates a task in the tomorrow bucket with a matched context', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-3',
      name: 'create_task',
      arguments: { title: 'Call the bank', due: 'tomorrow', context: 'personal' }
    })
    expect(result.output.status).toBe('done')
    const created = deps.upsertTask.mock.calls[0]?.[0] as Task
    expect(created.context).toBe('Personal')
    expect(created.status).toBe('Not started')
    const today = localIsoDate(new Date())
    expect(created.due > today).toBe(true)
  })

  it('refuses to execute delete_task before a confirmed re-call', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const first = await executor.execute({
      callId: 'call-4',
      name: 'delete_task',
      arguments: { task: 'physics problem set' }
    })
    expect(first.output.status).toBe('needs_confirmation')
    expect(first.audit).toBeNull()
    expect(deps.deleteTask).not.toHaveBeenCalled()

    const second = await executor.execute({
      callId: 'call-5',
      name: 'delete_task',
      arguments: { task: 'physics problem set', confirmed: true }
    })
    expect(second.output.status).toBe('done')
    expect(second.audit?.kind).toBe('delete_task')
    expect(deps.deleteTask).toHaveBeenCalledWith('task-1')
  })

  it('does not honour confirmed=true without a pending confirmation', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-6',
      name: 'delete_task',
      arguments: { task: 'physics problem set', confirmed: true }
    })
    expect(result.output.status).toBe('needs_confirmation')
    expect(deps.deleteTask).not.toHaveBeenCalled()
  })

  it('never navigates to the Journal', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-7',
      name: 'navigate',
      arguments: { route: '/journal' }
    })
    expect(result.output.status).toBe('error')
    expect(result.output.message).toBe('The Journal stays closed to Alfred')
    expect(deps.navigate).not.toHaveBeenCalled()
    expect(result.audit).toBeNull()
  })

  it('substitutes a voice note when no LeetCode solution is given', async () => {
    const deps = fakeDeps()
    const executor = createToolExecutor(deps)
    const result = await executor.execute({
      callId: 'call-8',
      name: 'add_leetcode_attempt',
      arguments: { problem: 'two sum' }
    })
    expect(result.output.status).toBe('done')
    expect(deps.addLeetCodeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'neetcode-1-1',
        solution: 'Logged by voice with Alfred; no source pasted.'
      })
    )
  })

  it('returns a speakable error instead of throwing on bad input', async () => {
    const executor = createToolExecutor(fakeDeps())
    const result = await executor.execute({
      callId: 'call-9',
      name: 'log_habit',
      arguments: { habit: 'reading', value: '37' }
    })
    expect(result.output.status).toBe('error')
    expect(result.audit).toBeNull()
  })

  it('rejects unknown tools', async () => {
    const executor = createToolExecutor(fakeDeps())
    const result = await executor.execute({
      callId: 'call-10',
      name: 'open_journal',
      arguments: {}
    })
    expect(result.output.status).toBe('error')
  })
})

describe('bestMatch', () => {
  it('prefers exact over prefix over substring matches', () => {
    const items = ['Physics reading', 'Physics', 'Read physics notes']
    expect(bestMatch(items, (item) => item, 'physics')).toBe('Physics')
    expect(bestMatch(items, (item) => item, 'physics read')).toBe('Physics reading')
    expect(bestMatch(items, (item) => item, 'zzz')).toBeNull()
  })
})
