import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CalendarStore } from './calendarStore'
import { excludeCalendarOccurrence } from '../shared/calendar'
import type { CalendarDefinition, CalendarEventRecord, CalendarSeed } from '../shared/calendar'

const CREATED_AT = '2026-08-20T12:00:00.000Z'

const PERSONAL: CalendarDefinition = {
  id: 'personal',
  name: 'Personal',
  color: '#3b684b',
  visible: true,
  readOnly: false,
  source: 'local',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT
}

const SECONDARY: CalendarDefinition = {
  ...PERSONAL,
  id: 'secondary',
  name: 'Secondary',
  color: '#6a4e6c'
}

const EVENT: CalendarEventRecord = {
  id: 'event-1',
  calendarId: PERSONAL.id,
  title: 'Weekly review',
  eventType: 'event',
  allDay: false,
  startDate: '2026-08-23',
  endDate: '2026-08-23',
  startTime: '18:00',
  endTime: '19:00',
  timeZone: 'America/Los_Angeles',
  location: '',
  description: '',
  conferenceUrl: '',
  visibility: 'default',
  busyStatus: 'busy',
  reminders: [10],
  notePageIds: [],
  recurrence: null,
  recurrenceParentId: null,
  recurrenceOriginalDate: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT
}

const SEED: CalendarSeed = {
  calendars: [PERSONAL],
  events: [EVENT],
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

function withStore(operation: (store: CalendarStore) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'manor-calendar-'))
  const store = new CalendarStore(join(folder, 'calendar.sqlite'))
  try {
    operation(store)
  } finally {
    store.close()
  }
}

describe('CalendarStore', () => {
  it('seeds once and persists event updates across a restart', () => {
    const folder = mkdtempSync(join(tmpdir(), 'manor-calendar-restart-'))
    const path = join(folder, 'calendar.sqlite')
    const first = new CalendarStore(path)
    first.load(SEED)
    first.upsertEvent({ ...EVENT, title: 'Changed review', updatedAt: '2026-08-21T12:00:00.000Z' })
    first.close()

    const second = new CalendarStore(path)
    const state = second.load({ ...SEED, events: [{ ...EVENT, title: 'Seed should not win' }] })
    expect(state.events[0]?.title).toBe('Changed review')
    second.close()
  })

  it('persists calendar visibility and settings', () => withStore((store) => {
    store.load(SEED)
    store.upsertCalendar({ ...PERSONAL, visible: false, updatedAt: '2026-08-21T12:00:00.000Z' })
    const state = store.updateSettings({ ...SEED.settings, weekStart: 'sunday', secondaryTimeZone: 'Asia/Kolkata' })
    expect(state.calendars[0]?.visible).toBe(false)
    expect(state.settings).toMatchObject({ weekStart: 'sunday', secondaryTimeZone: 'Asia/Kolkata' })
  }))

  it('deletes a local calendar and its events transactionally', () => withStore((store) => {
    store.load(SEED)
    const state = store.deleteCalendar(PERSONAL.id)
    expect(state.calendars).toEqual([])
    expect(state.events).toEqual([])
  }))

  it('rejects mutations to read-only calendar events', () => withStore((store) => {
    const readonlyCalendar = { ...PERSONAL, id: 'readonly', name: 'Linked', readOnly: true }
    store.load({ ...SEED, calendars: [readonlyCalendar], events: [] })
    expect(() => store.upsertEvent({ ...EVENT, calendarId: readonlyCalendar.id })).toThrow(/read-only/)
    expect(() => store.deleteCalendar(readonlyCalendar.id)).toThrow(/read-only/)
  }))

  it('persists one edited occurrence and removes it with its parent series', () => {
    const folder = mkdtempSync(join(tmpdir(), 'manor-calendar-occurrence-'))
    const path = join(folder, 'calendar.sqlite')
    const recurring = {
      ...EVENT,
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [0], excludedDates: [], end: { type: 'never' as const } }
    }
    const series = excludeCalendarOccurrence(recurring, '2026-08-30', '2026-08-22T15:00:00.000Z')
    const exception: CalendarEventRecord = {
      ...EVENT,
      id: 'event-1-exception',
      title: 'Moved weekly review',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      recurrenceParentId: recurring.id,
      recurrenceOriginalDate: '2026-08-30',
      updatedAt: '2026-08-22T15:00:00.000Z'
    }
    const first = new CalendarStore(path)
    first.load({ ...SEED, events: [recurring] })
    first.replaceOccurrence({ series, occurrenceDate: '2026-08-30', exception })
    first.close()

    const second = new CalendarStore(path)
    const restarted = second.load({ ...SEED, events: [] })
    expect(restarted.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: recurring.id, recurrence: expect.objectContaining({ excludedDates: ['2026-08-30'] }) }),
      expect.objectContaining({ id: exception.id, recurrenceParentId: recurring.id, recurrenceOriginalDate: '2026-08-30' })
    ]))
    expect(second.deleteEvent(recurring.id).events).toEqual([])
    second.close()
  })

  it('removes persisted occurrence exceptions when recurrence is removed', () => withStore((store) => {
    const recurring = {
      ...EVENT,
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [0], excludedDates: [], end: { type: 'never' as const } }
    }
    const series = excludeCalendarOccurrence(recurring, '2026-08-30', '2026-08-22T15:00:00.000Z')
    const exception: CalendarEventRecord = {
      ...EVENT,
      id: 'event-1-exception',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      recurrenceParentId: recurring.id,
      recurrenceOriginalDate: '2026-08-30'
    }
    store.load({ ...SEED, events: [recurring] })
    store.replaceOccurrence({ series, occurrenceDate: '2026-08-30', exception })
    const state = store.upsertEvent({ ...series, recurrence: null, updatedAt: '2026-08-22T16:00:00.000Z' })
    expect(state.events).toEqual([expect.objectContaining({ id: recurring.id, recurrence: null })])
  }))

  it('rejects moving a recurring series that owns edited occurrences', () => withStore((store) => {
    const recurring = {
      ...EVENT,
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [0], excludedDates: [], end: { type: 'never' as const } }
    }
    const series = excludeCalendarOccurrence(recurring, '2026-08-30', '2026-08-22T15:00:00.000Z')
    const exception: CalendarEventRecord = {
      ...EVENT,
      id: 'event-1-exception',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      recurrenceParentId: recurring.id,
      recurrenceOriginalDate: '2026-08-30'
    }
    store.load({ ...SEED, events: [recurring] })
    store.upsertCalendar(SECONDARY)
    store.replaceOccurrence({ series, occurrenceDate: '2026-08-30', exception })
    expect(() => store.upsertEvent({ ...series, calendarId: SECONDARY.id })).toThrow(/edited occurrences/)
  }))

  it('preserves an occurrence exception creation time across edits', () => withStore((store) => {
    const recurring = {
      ...EVENT,
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [0], excludedDates: [], end: { type: 'never' as const } }
    }
    const series = excludeCalendarOccurrence(recurring, '2026-08-30', '2026-08-22T15:00:00.000Z')
    const exception: CalendarEventRecord = {
      ...EVENT,
      id: 'event-1-exception',
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      recurrenceParentId: recurring.id,
      recurrenceOriginalDate: '2026-08-30'
    }
    store.load({ ...SEED, events: [recurring] })
    store.replaceOccurrence({ series, occurrenceDate: '2026-08-30', exception })
    const state = store.replaceOccurrence({
      series,
      occurrenceDate: '2026-08-30',
      exception: { ...exception, title: 'Edited exception', createdAt: '2026-08-22T18:00:00.000Z' }
    })
    expect(state.events.find((event) => event.id === exception.id)).toMatchObject({
      title: 'Edited exception',
      createdAt: CREATED_AT
    })
  }))

  it('collapses the interim lecture fixtures into one recurring series', () => withStore((store) => {
    const recurring = {
      ...EVENT,
      id: 'evt-calc-recurring',
      title: 'Calc III lecture',
      recurrence: { frequency: 'weekly' as const, interval: 1, weekdays: [1, 3, 5], excludedDates: [], end: { type: 'on' as const, date: '2026-09-30' } }
    }
    const state = store.load({
      ...SEED,
      events: [
        { ...EVENT, id: 'evt-calc-mon', title: 'Calc III lecture' },
        { ...EVENT, id: 'evt-calc-wed', title: 'Calc III lecture' },
        { ...EVENT, id: 'evt-calc-fri', title: 'Calc III lecture' },
        recurring
      ]
    })
    expect(state.events.filter((event) => event.title === 'Calc III lecture')).toEqual([recurring])
  }))
})
