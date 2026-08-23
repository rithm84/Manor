export const MOOD_SCALE = ['Great', 'Good', 'Neutral', 'Bad', 'Awful'] as const
export type Mood = (typeof MOOD_SCALE)[number]

export const FOCUS_SCALE = ['Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting'] as const
export type Focus = (typeof FOCUS_SCALE)[number]

export type MoodFocusNoteSource = 'manual' | 'alfred'
export type MoodFocusNoteWriteSource = 'alfred'

export interface MoodFocusEntry {
  date: string
  mood: Mood | null
  focus: Focus | null
  note: string | null
  noteSource: MoodFocusNoteSource | null
  createdAt: string
  updatedAt: string
}

export interface MoodFocusSeed {
  today: string
  entries: readonly MoodFocusEntry[]
}

export interface MoodFocusState {
  today: string
  entries: readonly MoodFocusEntry[]
}

export interface MoodMutation {
  date: string
  mood: Mood
}

export interface FocusMutation {
  date: string
  focus: Focus
}

export interface MoodFocusNoteMutation {
  date: string
  note: string | null
  source: MoodFocusNoteWriteSource | null
}

export interface MoodFocusApi {
  load: (seed: MoodFocusSeed) => Promise<MoodFocusState>
  setMood: (mutation: MoodMutation) => Promise<MoodFocusState>
  setFocus: (mutation: FocusMutation) => Promise<MoodFocusState>
  setNote: (mutation: MoodFocusNoteMutation) => Promise<MoodFocusState>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NOTE_LIMIT = 1000

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

function nullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null
  }
  const text = stringValue(value, label)
  if (text.length > NOTE_LIMIT) {
    throw new RangeError(`${label} must be ${NOTE_LIMIT} characters or fewer`)
  }
  return text
}

export function parseMoodFocusDate(value: unknown, label: string): string {
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

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function moodValue(value: unknown, nullable: boolean): Mood | null {
  if (nullable && value === null) {
    return null
  }
  if (typeof value !== 'string' || !MOOD_SCALE.includes(value as Mood)) {
    throw new TypeError(`mood must be one of ${MOOD_SCALE.join(', ')}`)
  }
  return value as Mood
}

function focusValue(value: unknown, nullable: boolean): Focus | null {
  if (nullable && value === null) {
    return null
  }
  if (typeof value !== 'string' || !FOCUS_SCALE.includes(value as Focus)) {
    throw new TypeError(`focus must be one of ${FOCUS_SCALE.join(', ')}`)
  }
  return value as Focus
}

function noteSourceValue(value: unknown, nullable: boolean): MoodFocusNoteSource | null {
  if (nullable && value === null) {
    return null
  }
  if (value !== 'manual' && value !== 'alfred') {
    throw new TypeError('note source must be manual or alfred')
  }
  return value
}

function noteWriteSourceValue(value: unknown, nullable: boolean): MoodFocusNoteWriteSource | null {
  if (nullable && value === null) {
    return null
  }
  if (value !== 'alfred') {
    throw new TypeError('new mood and focus context must come from Alfred')
  }
  return value
}

export function parseMoodFocusEntry(value: unknown): MoodFocusEntry {
  const entry = recordValue(value, 'mood and focus entry')
  const note = nullableString(entry.note, 'entry.note')
  const noteSource = noteSourceValue(entry.noteSource, true)
  if ((note === null) !== (noteSource === null)) {
    throw new TypeError('entry.note and entry.noteSource must either both be set or both be null')
  }
  const mood = moodValue(entry.mood, true)
  const focus = focusValue(entry.focus, true)
  if (mood === null && focus === null) {
    throw new TypeError('a mood and focus entry must contain mood or focus')
  }
  return {
    date: parseMoodFocusDate(entry.date, 'entry.date'),
    mood,
    focus,
    note,
    noteSource,
    createdAt: timestampValue(entry.createdAt, 'entry.createdAt'),
    updatedAt: timestampValue(entry.updatedAt, 'entry.updatedAt')
  }
}

export function parseMoodFocusSeed(value: unknown): MoodFocusSeed {
  const seed = recordValue(value, 'mood and focus seed')
  if (!Array.isArray(seed.entries)) {
    throw new TypeError('mood and focus seed entries must be an array')
  }
  const entries = seed.entries.map(parseMoodFocusEntry)
  const dates = new Set(entries.map((entry) => entry.date))
  if (dates.size !== entries.length) {
    throw new TypeError('mood and focus seed entries must have unique dates')
  }
  return {
    today: parseMoodFocusDate(seed.today, 'seed.today'),
    entries
  }
}

export function parseMoodMutation(value: unknown): MoodMutation {
  const mutation = recordValue(value, 'mood mutation')
  return {
    date: parseMoodFocusDate(mutation.date, 'mutation.date'),
    mood: moodValue(mutation.mood, false) as Mood
  }
}

export function parseFocusMutation(value: unknown): FocusMutation {
  const mutation = recordValue(value, 'focus mutation')
  return {
    date: parseMoodFocusDate(mutation.date, 'mutation.date'),
    focus: focusValue(mutation.focus, false) as Focus
  }
}

export function parseMoodFocusNoteMutation(value: unknown): MoodFocusNoteMutation {
  const mutation = recordValue(value, 'mood and focus note mutation')
  const note = nullableString(mutation.note, 'mutation.note')
  const source = noteWriteSourceValue(mutation.source, true)
  if ((note === null) !== (source === null)) {
    throw new TypeError('note and source must either both be set or both be null')
  }
  return {
    date: parseMoodFocusDate(mutation.date, 'mutation.date'),
    note,
    source
  }
}

export function moodFocusPreviousDate(dateValue: string): string {
  const date = parseMoodFocusDate(dateValue, 'date')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}
