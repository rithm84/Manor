import { describe, expect, it } from 'vitest'

import type { MasterFilterRule, Task } from '../../../shared/home'
import { filterTasks, taskMatchesRules } from './masterFilters'

const TASKS: readonly Task[] = [
  { id: 'one', title: 'Alpha', context: 'Personal', estimateMinutes: 60, priority: 'High', status: 'Not started', due: '2026-08-22', tags: [], recurrence: null },
  { id: 'two', title: 'Beta', context: 'Uni', estimateMinutes: 30, priority: 'Low', status: 'In Progress', due: '2026-08-25', tags: [], recurrence: null },
  { id: 'three', title: 'Gamma', context: 'Personal', estimateMinutes: null, priority: 'Medium', status: 'Done', due: '2026-09-02', tags: [], recurrence: null }
]

describe('Master task filters', () => {
  it('combines context, status, and priority rules with AND semantics', () => {
    const rules: readonly MasterFilterRule[] = [
      { id: 'context', property: 'context', value: 'Personal' },
      { id: 'status', property: 'status', value: 'Not started' },
      { id: 'priority', property: 'priority', value: 'High' }
    ]
    expect(filterTasks(TASKS, rules).map((task) => task.id)).toEqual(['one'])
  })

  it('supports before, on, after, and inclusive range due rules', () => {
    expect(taskMatchesRules(TASKS[0]!, [{ id: 'before', property: 'due', operator: 'before', date: '2026-08-23' }])).toBe(true)
    expect(taskMatchesRules(TASKS[1]!, [{ id: 'on', property: 'due', operator: 'on', date: '2026-08-25' }])).toBe(true)
    expect(taskMatchesRules(TASKS[2]!, [{ id: 'after', property: 'due', operator: 'after', date: '2026-09-01' }])).toBe(true)
    expect(filterTasks(TASKS, [{ id: 'range', property: 'due', operator: 'within', from: '2026-08-22', to: '2026-08-25' }]).map((task) => task.id)).toEqual(['one', 'two'])
  })

  it('returns the full task set when all applied property rules are cleared', () => {
    expect(filterTasks(TASKS, [])).toEqual(TASKS)
  })
})
