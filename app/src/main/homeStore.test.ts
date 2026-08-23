import { afterEach, describe, expect, it } from 'vitest'

import type {
  ContextDefinition,
  HomeSeed,
  SavedTaskView,
  ScratchBlock,
  Task
} from '../shared/home'
import { HomeStore } from './homeStore'

const TASK: Task = {
  id: 'task-one',
  title: 'Write the plan',
  context: 'Personal',
  estimateMinutes: 60,
  priority: 'Medium',
  status: 'Not started',
  due: '2026-08-22',
  tags: [],
  recurrence: null
}

const BLOCK: ScratchBlock = {
  id: 'block-one',
  taskId: TASK.id,
  date: '2026-08-22',
  start: '14:00',
  end: '15:00',
  portion: 'first half',
  createdAt: '2026-08-22T12:00:00.000Z',
  expiresAt: '2026-08-24T15:00:00.000Z'
}

const SAVED_VIEW: SavedTaskView = {
  id: 'view-one',
  name: 'Personal this week',
  rules: [
    { id: 'rule-context', property: 'context', value: 'Personal' },
    { id: 'rule-due', property: 'due', operator: 'within', from: '2026-08-22', to: '2026-08-29' }
  ]
}

const PERSONAL_CONTEXT: ContextDefinition = {
  name: 'Personal',
  color: 'success',
  icon: 'house'
}

const SEED: HomeSeed = {
  tasks: [TASK],
  contexts: [PERSONAL_CONTEXT],
  scratchBlocks: [BLOCK],
  savedTaskViews: [SAVED_VIEW]
}

let store: HomeStore | null = null

afterEach(() => {
  store?.close()
  store = null
})

describe('HomeStore', () => {
  it('seeds once and persists task, context, and block changes', () => {
    store = new HomeStore(':memory:')
    const initial = store.load(SEED, '2026-08-22T13:00:00.000Z')
    expect(initial.tasks).toEqual([TASK])
    expect(initial.scratchBlocks).toEqual([BLOCK])
    expect(initial.savedTaskViews).toEqual([SAVED_VIEW])

    store.upsertTask({ ...TASK, status: 'In Progress' }, '2026-08-22T13:01:00.000Z')
    const career = store.addContext({ name: 'Career', color: 'forest', icon: 'rocket' })
    store.upsertScratchBlock({ ...BLOCK, portion: 'outline only' }, '2026-08-22T13:02:00.000Z')

    store.upsertSavedTaskView({ ...SAVED_VIEW, name: 'Personal focus' }, '2026-08-22T13:03:00.000Z')

    const persisted = store.load({ tasks: [], contexts: [], scratchBlocks: [], savedTaskViews: [] }, '2026-08-22T13:04:00.000Z')
    expect(persisted.tasks[0]?.status).toBe('In Progress')
    expect(career).toEqual({ name: 'Career', color: 'forest', icon: 'rocket' })
    expect(persisted.contexts).toEqual([
      { name: 'Career', color: 'forest', icon: 'rocket' },
      PERSONAL_CONTEXT
    ])
    expect(persisted.scratchBlocks[0]?.portion).toBe('outline only')
    expect(persisted.savedTaskViews[0]?.name).toBe('Personal focus')
  })

  it('purges a scratch block after its expiry without deleting the task', () => {
    store = new HomeStore(':memory:')
    store.load(SEED, '2026-08-22T13:00:00.000Z')
    const state = store.load(SEED, '2026-08-24T15:00:00.000Z')
    expect(state.tasks).toHaveLength(1)
    expect(state.scratchBlocks).toHaveLength(0)
  })

  it('cascades scratch blocks when their task is deleted', () => {
    store = new HomeStore(':memory:')
    store.load(SEED, '2026-08-22T13:00:00.000Z')
    store.deleteTask(TASK.id)
    const state = store.load(SEED, '2026-08-22T13:01:00.000Z')
    expect(state.tasks).toHaveLength(0)
    expect(state.scratchBlocks).toHaveLength(0)
  })

  it('deletes a saved view without changing tasks', () => {
    store = new HomeStore(':memory:')
    store.load(SEED, '2026-08-22T13:00:00.000Z')
    store.deleteSavedTaskView(SAVED_VIEW.id)
    const state = store.load(SEED, '2026-08-22T13:01:00.000Z')
    expect(state.savedTaskViews).toHaveLength(0)
    expect(state.tasks).toEqual([TASK])
  })
})
