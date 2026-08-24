import type { EventInput } from '@fullcalendar/core'

import { addCalendarDays, convertCalendarWallTime, expandCalendarEvent } from '../../../../shared/calendar'
import type {
  CalendarDefinition,
  CalendarEventRecord,
  CalendarOccurrence
} from '../../../../shared/calendar'
import type { ContextDefinition, ScratchBlock, Task } from '../../../../shared/home'
import type { JobRole } from '../../../../shared/jobs'

export type CalendarItemKind = 'event' | 'task' | 'scratch' | 'job'

export interface CalendarItemReference {
  kind: CalendarItemKind
  sourceId: string
  occurrenceId: string
}

export interface CalendarOverlayInput extends EventInput {
  extendedProps: CalendarItemReference & { calendarId: string }
}

const CONTEXT_COLORS: Readonly<Record<ContextDefinition['color'], string>> = {
  forest: '#2f4127',
  success: '#3b684b',
  gold: '#6d6422',
  info: '#416883',
  plum: '#6b5375',
  today: '#825d16'
}

interface CalendarEventTone {
  backgroundColor: string
  borderColor: string
  textColor: string
}

const VIVID_CALENDAR_COLORS: Readonly<Record<string, string>> = {
  '#5db872': '#2f9f62',
  '#6f9fd8': '#2f9fda',
  '#416883': '#397ca7',
  '#2f4127': '#315f3e',
  '#3b684b': '#3c8057',
  '#6d6422': '#9b791b',
  '#6b5375': '#765983',
  '#825d16': '#a56f16'
}

/** Uses each calendar's configured source colour at full strength, as in Notion Calendar. */
export function calendarEventTone(color: string): CalendarEventTone {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new TypeError(`Calendar colour ${color} must use #RRGGBB`)
  const backgroundColor = VIVID_CALENDAR_COLORS[color.toLowerCase()] ?? color
  return { backgroundColor, borderColor: backgroundColor, textColor: '#ffffff' }
}

function gridDateTime(date: string, time: string, sourceTimeZone: string, primaryTimeZone: string): string {
  const converted = convertCalendarWallTime(date, time, sourceTimeZone, primaryTimeZone)
  return `${converted.date}T${converted.time}:00Z`
}

function requiredOccurrenceTime(value: string | null, label: string): string {
  if (value === null) throw new TypeError(`Timed calendar occurrence is missing its ${label}`)
  return value
}

function occurrenceInput(
  event: CalendarEventRecord,
  occurrence: CalendarOccurrence,
  calendar: CalendarDefinition,
  primaryTimeZone: string
): CalendarOverlayInput {
  const tone = calendarEventTone(calendar.color)
  return {
    id: occurrence.id,
    title: event.title,
    start: event.allDay
      ? occurrence.startDate
      : gridDateTime(occurrence.startDate, requiredOccurrenceTime(occurrence.startTime, 'start time'), event.timeZone, primaryTimeZone),
    end: event.allDay
      ? occurrence.endDate
      : gridDateTime(occurrence.endDate, requiredOccurrenceTime(occurrence.endTime, 'end time'), event.timeZone, primaryTimeZone),
    allDay: event.allDay,
    backgroundColor: tone.backgroundColor,
    borderColor: tone.borderColor,
    textColor: tone.textColor,
    editable: !calendar.readOnly,
    durationEditable: !calendar.readOnly,
    startEditable: !calendar.readOnly,
    classNames: [
      'manor-calendar-event',
      `manor-calendar-event--${event.eventType}`,
      event.busyStatus === 'free' ? 'is-free' : 'is-busy'
    ],
    extendedProps: {
      kind: 'event',
      sourceId: event.id,
      occurrenceId: occurrence.id,
      calendarId: event.calendarId
    }
  }
}

export function persistedEventInputs(
  events: readonly CalendarEventRecord[],
  calendars: readonly CalendarDefinition[],
  rangeStart: string,
  rangeEnd: string,
  primaryTimeZone: string
): readonly CalendarOverlayInput[] {
  const calendarById = new Map(calendars.map((calendar) => [calendar.id, calendar]))
  return events.flatMap((event) => {
    const calendar = calendarById.get(event.calendarId)
    if (calendar === undefined || !calendar.visible) return []
    return expandCalendarEvent(event, addCalendarDays(rangeStart, -2), addCalendarDays(rangeEnd, 2))
      .map((occurrence) => occurrenceInput(event, occurrence, calendar, primaryTimeZone))
      .filter((input) => {
        const start = typeof input.start === 'string' ? input.start.slice(0, 10) : ''
        const end = typeof input.end === 'string' ? input.end.slice(0, 10) : start
        return start < rangeEnd && end >= rangeStart
      })
  })
}

export function taskOverlayInputs(
  tasks: readonly Task[],
  contexts: readonly ContextDefinition[]
): readonly CalendarOverlayInput[] {
  const colorByContext = new Map(contexts.map((context) => [context.name, CONTEXT_COLORS[context.color]]))
  return tasks.filter((task) => task.status !== 'Done').map((task) => {
    const tone = calendarEventTone(colorByContext.get(task.context) ?? '#6a6669')
    return {
      id: `task:${task.id}`,
      title: task.title,
      start: task.due,
      end: addCalendarDays(task.due, 1),
      allDay: true,
      backgroundColor: tone.backgroundColor,
      borderColor: tone.borderColor,
      textColor: tone.textColor,
      editable: false,
      classNames: ['manor-calendar-overlay', 'manor-calendar-overlay--task'],
      extendedProps: {
        kind: 'task',
        sourceId: task.id,
        occurrenceId: `task:${task.id}`,
        calendarId: 'manor-tasks'
      }
    }
  })
}

export function scratchOverlayInputs(
  blocks: readonly ScratchBlock[],
  tasks: readonly Task[]
): readonly CalendarOverlayInput[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  return blocks.map((block) => {
    const endDate = block.end === '24:00' ? addCalendarDays(block.date, 1) : block.date
    const endTime = block.end === '24:00' ? '00:00' : block.end
    return {
      id: `scratch:${block.id}`,
      title: taskById.get(block.taskId)?.title ?? block.portion,
      start: `${block.date}T${block.start}:00Z`,
      end: `${endDate}T${endTime}:00Z`,
      allDay: false,
      backgroundColor: '#e5eef4',
      borderColor: '#416883',
      textColor: '#2f515d',
      editable: false,
      classNames: ['manor-calendar-overlay', 'manor-calendar-overlay--scratch'],
      extendedProps: {
        kind: 'scratch' as const,
        sourceId: block.id,
        occurrenceId: `scratch:${block.id}`,
        calendarId: 'manor-scratch'
      }
    }
  })
}

interface JobMilestone {
  key: keyof Pick<
    JobRole,
    'oaDueDate' | 'interview1Date' | 'interview2Date' | 'interview3Date' | 'decisionDate'
  >
  label: string
  color: string
}

const JOB_MILESTONES: readonly JobMilestone[] = [
  { key: 'oaDueDate', label: 'OA', color: '#825d16' },
  { key: 'interview1Date', label: 'Interview 1', color: '#6b5375' },
  { key: 'interview2Date', label: 'Interview 2', color: '#6b5375' },
  { key: 'interview3Date', label: 'Interview 3', color: '#6b5375' },
  { key: 'decisionDate', label: 'Decision', color: '#3b684b' }
]

export function jobOverlayInputs(roles: readonly JobRole[]): readonly CalendarOverlayInput[] {
  return roles.flatMap((role) => JOB_MILESTONES.flatMap((milestone) => {
    const date = role[milestone.key]
    if (date === null) return []
    const id = `job:${role.id}:${milestone.key}`
    const tone = calendarEventTone(milestone.color)
    return [{
      id,
      title: `${role.company} ${milestone.label}`,
      start: date,
      end: addCalendarDays(date, 1),
      allDay: true,
      backgroundColor: tone.backgroundColor,
      borderColor: tone.borderColor,
      textColor: tone.textColor,
      editable: false,
      classNames: ['manor-calendar-overlay', 'manor-calendar-overlay--job'],
      extendedProps: {
        kind: 'job' as const,
        sourceId: role.id,
        occurrenceId: id,
        calendarId: 'manor-jobs'
      }
    }]
  }))
}
