import { describe, expect, it } from 'vitest'

import type { CalendarEventRecord } from '../../../../shared/calendar'
import { shiftedCalendarGridEvent, shiftOccurrenceFromCalendarGrid } from './calendarGridTransforms'

const EVENT: CalendarEventRecord = {
  id: 'event', calendarId: 'personal', title: 'Review', eventType: 'event', allDay: false,
  startDate: '2026-08-20', endDate: '2026-08-20', startTime: '09:00', endTime: '10:00',
  timeZone: 'America/New_York', location: '', description: '', conferenceUrl: '',
  visibility: 'default', busyStatus: 'busy', reminders: [], notePageIds: [], recurrence: null,
  recurrenceParentId: null, recurrenceOriginalDate: null,
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z'
}

describe('Calendar grid transformations', () => {
  it('persists a drag in the event zone rather than the display zone', () => {
    const shifted = shiftedCalendarGridEvent(
      EVENT,
      new Date('2026-08-20T06:00:00.000Z'),
      new Date('2026-08-20T07:15:00.000Z'),
      new Date('2026-08-20T08:45:00.000Z'),
      'America/Los_Angeles',
      '2026-08-20T20:00:00.000Z'
    )
    expect(shifted).toMatchObject({
      startDate: '2026-08-20', startTime: '10:15',
      endDate: '2026-08-20', endTime: '11:45',
      timeZone: 'America/New_York'
    })
  })

  it('applies occurrence-only resize geometry without changing its parent identity', () => {
    const occurrence: CalendarEventRecord = {
      ...EVENT,
      id: 'event-exception',
      recurrenceParentId: 'series',
      recurrenceOriginalDate: '2026-08-20'
    }
    const shifted = shiftOccurrenceFromCalendarGrid(
      occurrence,
      new Date('2026-08-20T06:00:00.000Z'),
      new Date('2026-08-20T08:30:00.000Z'),
      'America/Los_Angeles',
      '2026-08-20T20:00:00.000Z'
    )
    expect(shifted).toMatchObject({
      startTime: '09:00', endTime: '11:30',
      recurrenceParentId: 'series', recurrenceOriginalDate: '2026-08-20'
    })
  })
})
