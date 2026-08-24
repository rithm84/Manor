import { describe, expect, it } from 'vitest'

import type { ScratchBlock } from '../../data/mock'
import {
  bucketForDue,
  canCreateTaskInBucket,
  compareWeeklyTasks,
  dueForTaskCreation,
  dueForBucket,
  findFreeStart,
  minutesToTime,
  scratchExpiry,
  taskCreationDefaults
} from './taskModel'
import { AXIS_END_MIN, AXIS_START_MIN } from './TodayPanel'

describe('computed task buckets', () => {
  it('rolls tasks between buckets when today changes', () => {
    expect(bucketForDue('2026-08-22', '2026-08-20')).toBe('week')
    expect(bucketForDue('2026-08-22', '2026-08-21')).toBe('tomorrow')
    expect(bucketForDue('2026-08-22', '2026-08-22')).toBe('today')
    expect(bucketForDue('2026-08-22', '2026-08-23')).toBe('overdue')
  })

  it('keeps longer-horizon tasks out of the weekly board', () => {
    expect(bucketForDue('2026-09-18', '2026-08-22')).toBeNull()
  })

  it('maps exact drop targets to true dates', () => {
    expect(dueForBucket('today', '2026-08-22')).toBe('2026-08-22')
    expect(dueForBucket('tomorrow', '2026-08-22')).toBe('2026-08-23')
  })

  it('prevents creation in Overdue and keeps Context intentionally unset in new drafts', () => {
    expect(canCreateTaskInBucket('overdue')).toBe(false)
    expect(taskCreationDefaults('today', '2026-08-22')).toEqual({
      context: null,
      due: '2026-08-22'
    })
    expect(taskCreationDefaults('week', '2026-08-22')).toEqual({ context: null, due: null })
    expect(() => dueForTaskCreation('overdue', '2026-08-22', null)).toThrow(
      'Overdue tasks cannot be created'
    )
  })

  it('defaults Today and Tomorrow creation to the bucket day', () => {
    expect(dueForTaskCreation('today', '2026-08-22', null)).toBe('2026-08-22')
    expect(dueForTaskCreation('tomorrow', '2026-08-22', null)).toBe('2026-08-23')
  })

  it('lets a due date picked in the dialog win over the bucket default', () => {
    expect(dueForTaskCreation('today', '2026-08-22', '2026-08-27')).toBe('2026-08-27')
    expect(dueForTaskCreation('tomorrow', '2026-08-22', '2026-09-04')).toBe('2026-09-04')
    expect(dueForTaskCreation('week', '2026-08-22', '2026-08-24')).toBe('2026-08-24')
  })

  it('requires an explicit date for This Week creation', () => {
    expect(() => dueForTaskCreation('week', '2026-08-22', null)).toThrow(
      'This Week tasks require an exact due date'
    )
  })

  it('orders the weekly board by exact due date, then High to Low priority', () => {
    const tasks = [
      { id: 'low', title: 'Low', context: 'Personal', estimateMinutes: null, priority: 'Low' as const, status: 'Not started' as const, due: '2026-08-25', tags: [], recurrence: null },
      { id: 'later', title: 'Later', context: 'Personal', estimateMinutes: null, priority: 'High' as const, status: 'Not started' as const, due: '2026-08-26', tags: [], recurrence: null },
      { id: 'none', title: 'None', context: 'Personal', estimateMinutes: null, priority: null, status: 'Not started' as const, due: '2026-08-25', tags: [], recurrence: null },
      { id: 'high', title: 'High', context: 'Personal', estimateMinutes: null, priority: 'High' as const, status: 'Not started' as const, due: '2026-08-25', tags: [], recurrence: null },
      { id: 'medium', title: 'Medium', context: 'Personal', estimateMinutes: null, priority: 'Medium' as const, status: 'Not started' as const, due: '2026-08-25', tags: [], recurrence: null }
    ]
    expect([...tasks].sort(compareWeeklyTasks).map((task) => task.id)).toEqual([
      'high', 'medium', 'low', 'none', 'later'
    ])
  })
})

describe('scratch block scheduling', () => {
  it('shows and schedules across the 6 AM to midnight range', () => {
    expect(AXIS_START_MIN).toBe(6 * 60)
    expect(AXIS_END_MIN).toBe(24 * 60)
    expect(findFreeStart('2026-09-10', 180, 21 * 60, [])).toBe('21:00')
    expect(minutesToTime(24 * 60)).toBe('24:00')
  })

  it('rejects blocks that cannot finish by midnight', () => {
    expect(() => findFreeStart('2026-09-10', 60, 23 * 60 + 15, [])).toThrow(
      'No free slot before midnight fits this task'
    )
  })

  it('finds the next free slot without changing task data', () => {
    const blocks: readonly ScratchBlock[] = [
      {
        id: 'block-one',
        taskId: 'task-one',
        date: '2026-08-22',
        start: '14:00',
        end: '15:00',
        portion: 'first half',
        createdAt: '2026-08-22T12:00:00.000Z',
        expiresAt: '2026-08-24T15:00:00.000Z'
      }
    ]
    expect(findFreeStart('2026-08-22', 60, 14 * 60, blocks)).toBe('15:00')
  })

  it('sets cleanup to 48 hours after scheduled end', () => {
    const expiry = new Date(scratchExpiry('2026-08-22', '15:00')).getTime()
    const scheduledEnd = new Date('2026-08-22T15:00:00').getTime()
    expect(expiry - scheduledEnd).toBe(48 * 60 * 60 * 1000)
  })
})
