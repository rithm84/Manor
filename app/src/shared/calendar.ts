export const CALENDAR_EVENT_TYPES = ['event', 'focus', 'out_of_office', 'birthday'] as const
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number]

export const CALENDAR_VISIBILITIES = ['default', 'public', 'private'] as const
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number]

export const CALENDAR_BUSY_STATUSES = ['busy', 'free'] as const
export type CalendarBusyStatus = (typeof CALENDAR_BUSY_STATUSES)[number]

export const CALENDAR_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type CalendarFrequency = (typeof CALENDAR_FREQUENCIES)[number]

export const CALENDAR_SOURCES = ['local', 'google', 'manor'] as const
export type CalendarSource = (typeof CALENDAR_SOURCES)[number]

export const CALENDAR_WEEK_STARTS = ['sunday', 'monday'] as const
export type CalendarWeekStart = (typeof CALENDAR_WEEK_STARTS)[number]

export interface CalendarRecurrence {
  frequency: CalendarFrequency
  interval: number
  weekdays: readonly number[]
  excludedDates: readonly string[]
  end: { type: 'never' } | { type: 'on'; date: string } | { type: 'after'; count: number }
}

export interface CalendarDefinition {
  id: string
  name: string
  color: string
  visible: boolean
  readOnly: boolean
  source: CalendarSource
  createdAt: string
  updatedAt: string
}

export interface CalendarEventRecord {
  id: string
  calendarId: string
  title: string
  eventType: CalendarEventType
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  timeZone: string
  location: string
  description: string
  conferenceUrl: string
  visibility: CalendarVisibility
  busyStatus: CalendarBusyStatus
  reminders: readonly number[]
  notePageIds: readonly string[]
  recurrence: CalendarRecurrence | null
  recurrenceParentId: string | null
  recurrenceOriginalDate: string | null
  createdAt: string
  updatedAt: string
}

export interface CalendarSettings {
  weekStart: CalendarWeekStart
  showWeekends: boolean
  workingHoursStart: string
  workingHoursEnd: string
  timeFormat: '12h' | '24h'
  primaryTimeZone: string
  secondaryTimeZone: string | null
}

export interface CalendarSeed {
  calendars: readonly CalendarDefinition[]
  events: readonly CalendarEventRecord[]
  settings: CalendarSettings
}

export interface CalendarState extends CalendarSeed {}

export interface CalendarApi {
  load: (seed: CalendarSeed) => Promise<CalendarState>
  upsertCalendar: (calendar: CalendarDefinition) => Promise<CalendarState>
  deleteCalendar: (calendarId: string) => Promise<CalendarState>
  upsertEvent: (event: CalendarEventRecord) => Promise<CalendarState>
  replaceOccurrence: (mutation: CalendarOccurrenceMutation) => Promise<CalendarState>
  deleteEvent: (eventId: string) => Promise<CalendarState>
  updateSettings: (settings: CalendarSettings) => Promise<CalendarState>
}

export interface CalendarOccurrenceMutation {
  series: CalendarEventRecord
  occurrenceDate: string
  exception: CalendarEventRecord | null
}

export interface CalendarOccurrence {
  id: string
  eventId: string
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const MAX_TITLE_LENGTH = 300
const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 20_000
const MAX_LOCATION_LENGTH = 500
const MAX_URL_LENGTH = 2_000
const WALL_TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function wallTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = WALL_TIME_FORMATTERS.get(timeZone)
  if (existing !== undefined) return existing
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  WALL_TIME_FORMATTERS.set(timeZone, formatter)
  return formatter
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function limitedString(value: unknown, label: string, maxLength: number): string {
  const text = stringValue(value, label)
  if (text.length > maxLength) {
    throw new RangeError(`${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function optionalString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string`)
  }
  const text = value.trim()
  if (text.length > maxLength) {
    throw new RangeError(`${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`)
  }
  return value
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string
): T[number] {
  if (typeof value !== 'string' || !values.includes(value as T[number])) {
    throw new TypeError(`${label} must be one of ${values.join(', ')}`)
  }
  return value as T[number]
}

export function parseCalendarDate(value: unknown, label: string): string {
  const date = stringValue(value, label)
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`)
  }
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`${label} must be a real calendar date`)
  }
  return date
}

export function parseCalendarTime(value: unknown, label: string): string {
  const time = stringValue(value, label)
  if (!TIME_PATTERN.test(time)) {
    throw new TypeError(`${label} must use HH:MM 24-hour format`)
  }
  return time
}

export function calendarLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return parseCalendarDate(`${year}-${month}-${day}`, 'local calendar date')
}

export function calendarLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return parseCalendarTime(`${hours}:${minutes}`, 'local calendar time')
}

export interface CalendarWallTime {
  date: string
  time: string
}

function dateTimePart(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((part) => part.type === type)?.value
  if (value === undefined) throw new Error(`Calendar time-zone formatter did not return ${type}`)
  return value
}

export function calendarWallTimeInZone(instant: Date, timeZoneValueInput: string): CalendarWallTime {
  if (Number.isNaN(instant.getTime())) throw new TypeError('calendar instant must be a real date')
  const timeZone = timeZoneValue(timeZoneValueInput, 'calendar time zone')
  const parts = wallTimeFormatter(timeZone).formatToParts(instant)
  return {
    date: parseCalendarDate(`${dateTimePart(parts, 'year')}-${dateTimePart(parts, 'month')}-${dateTimePart(parts, 'day')}`, 'zoned calendar date'),
    time: parseCalendarTime(`${dateTimePart(parts, 'hour')}:${dateTimePart(parts, 'minute')}`, 'zoned calendar time')
  }
}

export function calendarWallTimeToInstant(dateValue: string, timeValue: string, timeZoneValueInput: string): Date {
  const date = parseCalendarDate(dateValue, 'calendar wall date')
  const time = parseCalendarTime(timeValue, 'calendar wall time')
  const timeZone = timeZoneValue(timeZoneValueInput, 'calendar wall time zone')
  const target = Date.parse(`${date}T${time}:00.000Z`)
  let candidate = target
  for (let pass = 0; pass < 4; pass += 1) {
    const rendered = calendarWallTimeInZone(new Date(candidate), timeZone)
    const renderedPseudoUtc = Date.parse(`${rendered.date}T${rendered.time}:00.000Z`)
    const correction = target - renderedPseudoUtc
    if (correction === 0) return new Date(candidate)
    candidate += correction
  }
  const rendered = calendarWallTimeInZone(new Date(candidate), timeZone)
  if (rendered.date !== date || rendered.time !== time) {
    throw new RangeError(`${date} ${time} does not exist in ${timeZone}`)
  }
  return new Date(candidate)
}

export function convertCalendarWallTime(date: string, time: string, sourceTimeZone: string, targetTimeZone: string): CalendarWallTime {
  return calendarWallTimeInZone(calendarWallTimeToInstant(date, time, sourceTimeZone), targetTimeZone)
}

export function calendarGridDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new TypeError('calendar grid date must be a real date')
  return parseCalendarDate(date.toISOString().slice(0, 10), 'calendar grid date')
}

export function calendarGridTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new TypeError('calendar grid time must be a real date')
  return parseCalendarTime(date.toISOString().slice(11, 16), 'calendar grid time')
}

function timeZoneValue(value: unknown, label: string): string {
  const timeZone = stringValue(value, label)
  try {
    wallTimeFormatter(timeZone).format(new Date())
  } catch {
    throw new TypeError(`${label} must be a supported IANA time zone`)
  }
  return timeZone
}

function nullableTimeZone(value: unknown, label: string): string | null {
  return value === null ? null : timeZoneValue(value, label)
}

function urlValue(value: unknown, label: string): string {
  const url = optionalString(value, label, MAX_URL_LENGTH)
  if (url === '') return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`${label} must use http or https`)
  }
  return url
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

export function parseCalendarRecurrence(value: unknown): CalendarRecurrence {
  const rule = recordValue(value, 'calendar recurrence')
  if (!Array.isArray(rule.weekdays)) {
    throw new TypeError('calendar recurrence weekdays must be an array')
  }
  const weekdays = [...new Set(rule.weekdays.map((day, index) =>
    integerValue(day, `calendar recurrence weekday ${index + 1}`, 0, 6)
  ))].sort((a, b) => a - b)
  const end = recordValue(rule.end, 'calendar recurrence end')
  const endType = enumValue(end.type, ['never', 'on', 'after'] as const, 'calendar recurrence end type')
  const excludedDatesValue = rule.excludedDates ?? []
  if (!Array.isArray(excludedDatesValue)) {
    throw new TypeError('calendar recurrence excludedDates must be an array')
  }
  const excludedDates = [...new Set(excludedDatesValue.map((date, index) =>
    parseCalendarDate(date, `calendar recurrence excluded date ${index + 1}`)
  ))].sort()
  return {
    frequency: enumValue(rule.frequency, CALENDAR_FREQUENCIES, 'calendar recurrence frequency'),
    interval: integerValue(rule.interval, 'calendar recurrence interval', 1, 365),
    weekdays,
    excludedDates,
    end: endType === 'on'
      ? { type: 'on', date: parseCalendarDate(end.date, 'calendar recurrence end date') }
      : endType === 'after'
        ? { type: 'after', count: integerValue(end.count, 'calendar recurrence count', 1, 999) }
        : { type: 'never' }
  }
}

export function parseCalendarOccurrenceMutation(value: unknown): CalendarOccurrenceMutation {
  const mutation = recordValue(value, 'calendar occurrence mutation')
  const series = parseCalendarEvent(mutation.series)
  const occurrenceDate = parseCalendarDate(mutation.occurrenceDate, 'calendar occurrence date')
  const exception = mutation.exception === null ? null : parseCalendarEvent(mutation.exception)
  if (series.recurrence === null) {
    throw new TypeError('calendar occurrence mutation series must recur')
  }
  if (!series.recurrence.excludedDates.includes(occurrenceDate)) {
    throw new TypeError('calendar occurrence mutation series must exclude the replaced occurrence')
  }
  if (exception !== null) {
    if (exception.recurrence !== null) {
      throw new TypeError('calendar occurrence exceptions cannot recur')
    }
    if (exception.id === series.id) {
      throw new TypeError('calendar occurrence exception must have a distinct id')
    }
    if (exception.calendarId !== series.calendarId) {
      throw new TypeError('calendar occurrence exception must use the series calendar')
    }
    if (exception.recurrenceParentId !== series.id || exception.recurrenceOriginalDate !== occurrenceDate) {
      throw new TypeError('calendar occurrence exception must identify its parent series and original date')
    }
  }
  return { series, occurrenceDate, exception }
}

export function parseCalendarDefinition(value: unknown): CalendarDefinition {
  const calendar = recordValue(value, 'calendar')
  const color = stringValue(calendar.color, 'calendar.color')
  if (!COLOR_PATTERN.test(color)) {
    throw new TypeError('calendar.color must be a six-digit hex color')
  }
  return {
    id: stringValue(calendar.id, 'calendar.id'),
    name: limitedString(calendar.name, 'calendar.name', MAX_NAME_LENGTH),
    color: color.toLowerCase(),
    visible: booleanValue(calendar.visible, 'calendar.visible'),
    readOnly: booleanValue(calendar.readOnly, 'calendar.readOnly'),
    source: enumValue(calendar.source, CALENDAR_SOURCES, 'calendar.source'),
    createdAt: timestampValue(calendar.createdAt, 'calendar.createdAt'),
    updatedAt: timestampValue(calendar.updatedAt, 'calendar.updatedAt')
  }
}

export function parseCalendarEvent(value: unknown): CalendarEventRecord {
  const event = recordValue(value, 'calendar event')
  if (!Array.isArray(event.reminders)) {
    throw new TypeError('calendar event reminders must be an array')
  }
  const notePageIdsValue = event.notePageIds ?? []
  if (!Array.isArray(notePageIdsValue)) {
    throw new TypeError('calendar event notePageIds must be an array')
  }
  const allDay = booleanValue(event.allDay, 'calendar event allDay')
  const startDate = parseCalendarDate(event.startDate, 'calendar event startDate')
  const endDate = parseCalendarDate(event.endDate, 'calendar event endDate')
  const startTime = event.startTime === null ? null : parseCalendarTime(event.startTime, 'calendar event startTime')
  const endTime = event.endTime === null ? null : parseCalendarTime(event.endTime, 'calendar event endTime')
  if (allDay && (startTime !== null || endTime !== null)) {
    throw new TypeError('all-day calendar events cannot have start or end times')
  }
  if (!allDay && (startTime === null || endTime === null)) {
    throw new TypeError('timed calendar events require start and end times')
  }
  if (compareDateTime(startDate, startTime, endDate, endTime) >= 0) {
    throw new RangeError('calendar event end must be after its start')
  }
  const recurrence = event.recurrence === null ? null : parseCalendarRecurrence(event.recurrence)
  const recurrenceParentId = event.recurrenceParentId === undefined || event.recurrenceParentId === null
    ? null
    : stringValue(event.recurrenceParentId, 'calendar event recurrenceParentId')
  const recurrenceOriginalDate = event.recurrenceOriginalDate === undefined || event.recurrenceOriginalDate === null
    ? null
    : parseCalendarDate(event.recurrenceOriginalDate, 'calendar event recurrenceOriginalDate')
  if ((recurrenceParentId === null) !== (recurrenceOriginalDate === null)) {
    throw new TypeError('calendar recurrence exception parent and original date must be set together')
  }
  if (recurrence !== null && recurrenceParentId !== null) {
    throw new TypeError('recurring calendar events cannot also be occurrence exceptions')
  }
  return {
    id: stringValue(event.id, 'calendar event id'),
    calendarId: stringValue(event.calendarId, 'calendar event calendarId'),
    title: limitedString(event.title, 'calendar event title', MAX_TITLE_LENGTH),
    eventType: enumValue(event.eventType, CALENDAR_EVENT_TYPES, 'calendar event type'),
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    timeZone: timeZoneValue(event.timeZone, 'calendar event timeZone'),
    location: optionalString(event.location, 'calendar event location', MAX_LOCATION_LENGTH),
    description: optionalString(event.description, 'calendar event description', MAX_DESCRIPTION_LENGTH),
    conferenceUrl: urlValue(event.conferenceUrl, 'calendar event conferenceUrl'),
    visibility: enumValue(event.visibility, CALENDAR_VISIBILITIES, 'calendar event visibility'),
    busyStatus: enumValue(event.busyStatus, CALENDAR_BUSY_STATUSES, 'calendar event busyStatus'),
    reminders: [...new Set(event.reminders.map((minutes, index) =>
      integerValue(minutes, `calendar event reminder ${index + 1}`, 0, 40_320)
    ))].sort((a, b) => a - b),
    notePageIds: [...new Set(notePageIdsValue.map((notePageId, index) =>
      stringValue(notePageId, `calendar event note page ${index + 1}`)
    ))],
    recurrence,
    recurrenceParentId,
    recurrenceOriginalDate,
    createdAt: timestampValue(event.createdAt, 'calendar event createdAt'),
    updatedAt: timestampValue(event.updatedAt, 'calendar event updatedAt')
  }
}

export function parseCalendarSettings(value: unknown): CalendarSettings {
  const settings = recordValue(value, 'calendar settings')
  const start = parseCalendarTime(settings.workingHoursStart, 'calendar workingHoursStart')
  const end = parseCalendarTime(settings.workingHoursEnd, 'calendar workingHoursEnd')
  if (start >= end) {
    throw new RangeError('calendar working hours end must be after start')
  }
  return {
    weekStart: enumValue(settings.weekStart, CALENDAR_WEEK_STARTS, 'calendar weekStart'),
    showWeekends: booleanValue(settings.showWeekends, 'calendar showWeekends'),
    workingHoursStart: start,
    workingHoursEnd: end,
    timeFormat: enumValue(settings.timeFormat, ['12h', '24h'] as const, 'calendar timeFormat'),
    primaryTimeZone: timeZoneValue(settings.primaryTimeZone, 'calendar primaryTimeZone'),
    secondaryTimeZone: nullableTimeZone(settings.secondaryTimeZone, 'calendar secondaryTimeZone')
  }
}

export function parseCalendarSeed(value: unknown): CalendarSeed {
  const seed = recordValue(value, 'calendar seed')
  if (!Array.isArray(seed.calendars) || !Array.isArray(seed.events)) {
    throw new TypeError('calendar seed calendars and events must be arrays')
  }
  const calendars = seed.calendars.map(parseCalendarDefinition)
  const events = seed.events.map(parseCalendarEvent)
  const calendarIds = new Set(calendars.map((calendar) => calendar.id))
  if (calendarIds.size !== calendars.length) {
    throw new TypeError('calendar seed calendar ids must be unique')
  }
  const eventIds = new Set(events.map((event) => event.id))
  if (eventIds.size !== events.length) {
    throw new TypeError('calendar seed event ids must be unique')
  }
  events.forEach((event) => {
    if (!calendarIds.has(event.calendarId)) {
      throw new TypeError(`calendar event ${event.id} references missing calendar ${event.calendarId}`)
    }
  })
  return { calendars, events, settings: parseCalendarSettings(seed.settings) }
}

export function parseCalendarId(value: unknown, label: string): string {
  return stringValue(value, label)
}

function compareDateTime(
  firstDate: string,
  firstTime: string | null,
  secondDate: string,
  secondTime: string | null
): number {
  return `${firstDate}T${firstTime ?? '00:00'}`.localeCompare(`${secondDate}T${secondTime ?? '00:00'}`)
}

export function addCalendarDays(date: string, amount: number): string {
  const parsed = new Date(`${parseCalendarDate(date, 'calendar date')}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + amount)
  return parsed.toISOString().slice(0, 10)
}

export function addCalendarMonths(date: string, amount: number): string | null {
  const parsed = new Date(`${parseCalendarDate(date, 'calendar date')}T00:00:00.000Z`)
  const day = parsed.getUTCDate()
  parsed.setUTCDate(1)
  parsed.setUTCMonth(parsed.getUTCMonth() + amount)
  const targetMonth = parsed.getUTCMonth()
  parsed.setUTCDate(day)
  return parsed.getUTCMonth() === targetMonth ? parsed.toISOString().slice(0, 10) : null
}

export function calendarWeekday(date: string): number {
  return new Date(`${parseCalendarDate(date, 'calendar date')}T00:00:00.000Z`).getUTCDay()
}

function daysBetween(first: string, second: string): number {
  const firstTime = Date.parse(`${first}T00:00:00.000Z`)
  const secondTime = Date.parse(`${second}T00:00:00.000Z`)
  return Math.round((secondTime - firstTime) / 86_400_000)
}

function recurrencePatternMatches(event: CalendarEventRecord, date: string): boolean {
  const rule = event.recurrence
  if (rule === null || date < event.startDate) return date === event.startDate
  const elapsedDays = daysBetween(event.startDate, date)
  if (rule.frequency === 'daily') return elapsedDays % rule.interval === 0
  if (rule.frequency === 'weekly') {
    const weekdays = rule.weekdays.length > 0 ? rule.weekdays : [calendarWeekday(event.startDate)]
    const startWeek = addCalendarDays(event.startDate, -calendarWeekday(event.startDate))
    const dateWeek = addCalendarDays(date, -calendarWeekday(date))
    return daysBetween(startWeek, dateWeek) / 7 % rule.interval === 0 && weekdays.includes(calendarWeekday(date))
  }
  if (rule.frequency === 'monthly') {
    const start = new Date(`${event.startDate}T00:00:00.000Z`)
    const current = new Date(`${date}T00:00:00.000Z`)
    const months = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth()
    return months >= 0 && months % rule.interval === 0 && current.getUTCDate() === start.getUTCDate()
  }
  const start = new Date(`${event.startDate}T00:00:00.000Z`)
  const current = new Date(`${date}T00:00:00.000Z`)
  const years = current.getUTCFullYear() - start.getUTCFullYear()
  return years >= 0 && years % rule.interval === 0 && current.getUTCMonth() === start.getUTCMonth() && current.getUTCDate() === start.getUTCDate()
}

function recurrenceMatches(event: CalendarEventRecord, date: string): boolean {
  return recurrencePatternMatches(event, date) && !event.recurrence?.excludedDates.includes(date)
}

function occurrenceEndDate(event: CalendarEventRecord, startDate: string): string {
  return addCalendarDays(startDate, daysBetween(event.startDate, event.endDate))
}

export function expandCalendarEvent(
  eventValue: CalendarEventRecord,
  rangeStartValue: string,
  rangeEndValue: string
): readonly CalendarOccurrence[] {
  const event = parseCalendarEvent(eventValue)
  const rangeStart = parseCalendarDate(rangeStartValue, 'calendar range start')
  const rangeEnd = parseCalendarDate(rangeEndValue, 'calendar range end')
  if (rangeStart >= rangeEnd) {
    throw new RangeError('calendar range end must be after start')
  }
  const occurrences: CalendarOccurrence[] = []
  let occurrenceCount = 0
  for (let date = event.startDate; date < rangeEnd; date = addCalendarDays(date, 1)) {
    if (!recurrencePatternMatches(event, date)) continue
    occurrenceCount += 1
    const rule = event.recurrence
    if (rule?.end.type === 'after' && occurrenceCount > rule.end.count) break
    if (rule?.end.type === 'on' && date > rule.end.date) break
    if (!recurrenceMatches(event, date)) continue
    if (date < rangeStart) continue
    occurrences.push({
      id: rule === null ? event.id : `${event.id}::${date}`,
      eventId: event.id,
      startDate: date,
      endDate: occurrenceEndDate(event, date),
      startTime: event.startTime,
      endTime: event.endTime
    })
    if (rule === null) break
  }
  return occurrences
}

export function calendarEventForOccurrence(
  eventValue: CalendarEventRecord,
  occurrenceDateValue: string
): CalendarEventRecord {
  const event = parseCalendarEvent(eventValue)
  const occurrenceDate = parseCalendarDate(occurrenceDateValue, 'calendar occurrence date')
  const occurrence = expandCalendarEvent(event, occurrenceDate, addCalendarDays(occurrenceDate, 1))[0]
  if (occurrence === undefined) {
    throw new Error(`Calendar event ${event.id} does not occur on ${occurrenceDate}`)
  }
  return parseCalendarEvent({
    ...event,
    startDate: occurrence.startDate,
    endDate: occurrence.endDate,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime
  })
}

export function excludeCalendarOccurrence(
  eventValue: CalendarEventRecord,
  occurrenceDateValue: string,
  updatedAtValue: string
): CalendarEventRecord {
  const event = parseCalendarEvent(eventValue)
  const occurrenceDate = parseCalendarDate(occurrenceDateValue, 'calendar occurrence date')
  if (event.recurrence === null) {
    throw new TypeError(`Calendar event ${event.id} does not recur`)
  }
  if (!event.recurrence.excludedDates.includes(occurrenceDate)) {
    calendarEventForOccurrence(event, occurrenceDate)
  }
  return parseCalendarEvent({
    ...event,
    recurrence: {
      ...event.recurrence,
      excludedDates: [...new Set([...event.recurrence.excludedDates, occurrenceDate])].sort()
    },
    updatedAt: timestampValue(updatedAtValue, 'calendar occurrence updatedAt')
  })
}

export function shiftCalendarEvent(
  eventValue: CalendarEventRecord,
  nextStartDateValue: string,
  nextStartTimeValue: string | null,
  nextEndDateValue: string,
  nextEndTimeValue: string | null,
  updatedAtValue: string
): CalendarEventRecord {
  const event = parseCalendarEvent(eventValue)
  return parseCalendarEvent({
    ...event,
    startDate: parseCalendarDate(nextStartDateValue, 'shifted start date'),
    startTime: event.allDay ? null : parseCalendarTime(nextStartTimeValue, 'shifted start time'),
    endDate: parseCalendarDate(nextEndDateValue, 'shifted end date'),
    endTime: event.allDay ? null : parseCalendarTime(nextEndTimeValue, 'shifted end time'),
    updatedAt: timestampValue(updatedAtValue, 'shifted event updatedAt')
  })
}
