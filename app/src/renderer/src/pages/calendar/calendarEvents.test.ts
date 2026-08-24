import { describe, expect, it } from 'vitest'

import type { CalendarDefinition, CalendarEventRecord } from '../../../../shared/calendar'
import type { ScratchBlock, Task } from '../../../../shared/home'
import type { JobRole } from '../../../../shared/jobs'
import { calendarEventTone, jobOverlayInputs, persistedEventInputs, scratchOverlayInputs } from './calendarEvents'
import { createCalendarSeed } from './calendarSeed'

const CALENDAR: CalendarDefinition = {
  id: 'personal', name: 'Personal', color: '#3b684b', visible: true, readOnly: false,
  source: 'local', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
}

const EVENT: CalendarEventRecord = {
  id: 'event', calendarId: 'personal', title: 'Review', eventType: 'event', allDay: false,
  startDate: '2026-08-20', endDate: '2026-08-20', startTime: '10:00', endTime: '11:00',
  timeZone: 'America/Los_Angeles', location: '', description: '', conferenceUrl: '',
  visibility: 'default', busyStatus: 'busy', reminders: [], notePageIds: [], recurrence: null,
  recurrenceParentId: null, recurrenceOriginalDate: null,
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
}

describe('calendar source overlays', () => {
  it('derives a tint fill, full-strength accent bar, and darkened text from the source colour', () => {
    expect(calendarEventTone('#3B684B')).toEqual({
      backgroundColor: '#e2e8e4', borderColor: '#3b684b', textColor: '#33533f'
    })
  })

  it('rejects colours that are not #RRGGBB', () => {
    expect(() => calendarEventTone('rebeccapurple')).toThrow(TypeError)
  })

  it('keeps scratch blocks as one Home-derived overlay instead of a duplicate calendar', () => {
    expect(createCalendarSeed().calendars.map((calendar) => calendar.id)).not.toContain('manor-scratch')
  })

  it('omits events from hidden calendars', () => {
    expect(persistedEventInputs([EVENT], [{ ...CALENDAR, visible: false }], '2026-08-01', '2026-09-01', 'America/Los_Angeles')).toEqual([])
  })

  it('renders timed events in the selected primary time zone', () => {
    const [input] = persistedEventInputs(
      [{ ...EVENT, timeZone: 'America/New_York', startTime: '09:00', endTime: '10:30' }],
      [CALENDAR],
      '2026-08-01',
      '2026-09-01',
      'America/Los_Angeles'
    )
    expect(input).toMatchObject({
      start: '2026-08-20T06:00:00Z',
      end: '2026-08-20T07:30:00Z'
    })
  })

  it('keeps cross-zone events that move across a primary-zone date boundary', () => {
    const [input] = persistedEventInputs(
      [{ ...EVENT, timeZone: 'Asia/Tokyo', startTime: '01:00', endTime: '02:00' }],
      [CALENDAR],
      '2026-08-19',
      '2026-08-20',
      'America/Los_Angeles'
    )
    expect(input).toMatchObject({ start: '2026-08-19T09:00:00Z', end: '2026-08-19T10:00:00Z' })
  })

  it('maps scratch blocks without duplicating their task record', () => {
    const task: Task = {
      id: 'task', title: 'Draft proposal', due: '2026-08-20', context: 'Personal',
      estimateMinutes: 60, priority: 'High', status: 'Not started', tags: [], recurrence: null
    }
    const block: ScratchBlock = {
      id: 'block', taskId: task.id, date: '2026-08-20', start: '23:00', end: '24:00',
      portion: 'outline', createdAt: '2026-08-20T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z'
    }
    const [input] = scratchOverlayInputs([block], [task])
    expect(input).toMatchObject({
      id: 'scratch:block', title: task.title, end: '2026-08-21T00:00:00Z', editable: false,
      extendedProps: { kind: 'scratch', sourceId: block.id }
    })
  })

  it('renders every filled Jobs milestone as a linked all-day overlay', () => {
    const role: JobRole = {
      id: 'role', company: 'Linear', role: 'SWE', location: '', postingLink: '', datePosted: null,
      stage: 'interview_1', appliedDate: '2026-08-10', oaDueDate: '2026-08-20',
      interview1Date: '2026-08-22', interview2Date: null, interview3Date: null, decisionDate: null,
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
    }
    const overlays = jobOverlayInputs([role])
    expect(overlays.map((overlay) => overlay.title)).toEqual(['Linear OA', 'Linear Interview 1'])
    expect(overlays.every((overlay) => overlay.editable === false)).toBe(true)
  })
})
