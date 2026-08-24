import type { CalendarSeed } from '../../../../shared/calendar'
import { calendars, events } from '../../data/mock'

const CREATED_AT = '2026-08-18T08:00:00.000Z'

export function createCalendarSeed(): CalendarSeed {
  const sourceEvents = events.filter((event) => !event.scratch && !event.id.startsWith('evt-calc-'))
  return {
    calendars: calendars.filter((calendar) => !calendar.scratch).map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      visible: calendar.enabled,
      readOnly: false,
      source: 'local',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    })),
    events: [
      ...sourceEvents.map((event) => ({
      id: event.id,
      calendarId: event.calendarId,
      title: event.title,
      eventType: 'event' as const,
      allDay: false,
      startDate: event.date,
      endDate: event.date,
      startTime: event.start,
      endTime: event.end,
      timeZone: 'America/Los_Angeles',
      location: '',
      description: event.note ?? '',
      conferenceUrl: '',
      visibility: 'default' as const,
      busyStatus: 'busy' as const,
      reminders: [10],
      notePageIds: [],
      recurrence: null,
      recurrenceParentId: null,
      recurrenceOriginalDate: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
      })),
      {
        id: 'evt-calc-recurring',
        calendarId: 'ucla',
        title: 'Calc III lecture',
        eventType: 'event' as const,
        allDay: false,
        startDate: '2026-08-17',
        endDate: '2026-08-17',
        startTime: '10:00',
        endTime: '11:15',
        timeZone: 'America/Los_Angeles',
        location: '',
        description: '',
        conferenceUrl: '',
        visibility: 'default' as const,
        busyStatus: 'busy' as const,
        reminders: [10],
        notePageIds: [],
        recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [1, 3, 5], excludedDates: [], end: { type: 'on' as const, date: '2026-09-30' } },
        recurrenceParentId: null,
        recurrenceOriginalDate: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT
      }
    ],
    settings: {
      weekStart: 'monday',
      showWeekends: true,
      workingHoursStart: '08:00',
      workingHoursEnd: '18:00',
      timeFormat: '12h',
      primaryTimeZone: 'America/Los_Angeles',
      secondaryTimeZone: null
    }
  }
}
