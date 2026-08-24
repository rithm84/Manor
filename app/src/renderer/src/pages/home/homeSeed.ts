import type { HomeSeed, ScratchBlock } from '../../../../shared/home'
import { events, taskContexts, tasks } from '../../data/mock'
import { scratchExpiry } from './taskModel'

const SEED_PORTIONS: Readonly<Record<string, string>> = {
  'evt-scratch-mon': 'first pass',
  'evt-neetcode-block': 'first half',
  'evt-neetcode-fri': 'rest',
  'evt-weekly-review': 'full task'
}

function scratchBlocks(): readonly ScratchBlock[] {
  return events.flatMap((event) => {
    if (!event.scratch || event.taskId === null) return []
    return [{
      id: event.id,
      taskId: event.taskId,
      date: event.date,
      start: event.start,
      end: event.end,
      portion: SEED_PORTIONS[event.id] ?? 'planned work',
      createdAt: new Date(`${event.date}T${event.start}:00`).toISOString(),
      expiresAt: scratchExpiry(event.date, event.end)
    }]
  })
}

export function createHomeSeed(): HomeSeed {
  return {
    tasks,
    contexts: taskContexts,
    scratchBlocks: scratchBlocks(),
    savedTaskViews: []
  }
}
