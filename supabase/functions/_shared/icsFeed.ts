// Parses an iCalendar feed (RFC 5545) into course deadline items. Canvas titles end with the course in brackets.

export interface CourseFeedItem {
 uid: string
 title: string
 course: string | null
 /** Instant of the deadline; null for all-day items. */
 due_at: string | null
 /** The deadline's date in the account's time zone. */
 due_date: string
 all_day: boolean
 url: string | null
 description: string | null
}

interface RawEvent { uid: string; summary: string; description: string | null; url: string | null; start: { kind: 'date'; value: string } | { kind: 'instant'; iso: string } | { kind: 'floating'; parts: number[] } }

const MAX_DESCRIPTION = 500

/** Joins folded lines: a line starting with a space or tab continues the previous one. */
function unfold(text: string): string[] {
 const lines: string[] = []
 for (const line of text.split(/\r?\n/)) {
  if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) lines[lines.length - 1] += line.slice(1)
  else lines.push(line)
 }
 return lines
}

function unescapeText(value: string): string {
 return value.replaceAll('\\n', '\n').replaceAll('\\N', '\n').replaceAll('\\,', ',').replaceAll('\;', ';').replaceAll('\\\\', '\\')
}

/** Splits `NAME;PARAM=VALUE:value` into its name, parameters, and value. */
function property(line: string): { name: string; params: Record<string, string>; value: string } | null {
 const colon = line.indexOf(':')
 if (colon < 0) return null
 const [name, ...paramParts] = line.slice(0, colon).split(';')
 const params: Record<string, string> = {}
 for (const part of paramParts) { const eq = part.indexOf('='); if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replaceAll('"', '') }
 return { name: (name ?? '').toUpperCase(), params, value: line.slice(colon + 1) }
}

const dateTimeParts = (value: string): number[] | null => {
 const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(value)
 if (match === null) return null
 return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)]
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
 const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant))
 const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0')
 return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant
}

/** The instant for a wall-clock time in `timeZone`; a second pass settles daylight-saving edges. */
export function zonedInstant(parts: readonly number[], timeZone: string): Date {
 const [y, m, d, h, mi, s] = parts as [number, number, number, number, number, number]
 const wall = Date.UTC(y, m - 1, d, h, mi, s)
 let guess = wall - zoneOffset(wall, timeZone)
 guess = wall - zoneOffset(guess, timeZone)
 return new Date(guess)
}

export function localDate(instant: Date, timeZone: string): string {
 return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

export function parseIcs(text: string): RawEvent[] {
 if (!text.includes('BEGIN:VCALENDAR')) throw new Error('The link did not return a calendar feed')
 const events: RawEvent[] = []
 let current: Partial<RawEvent> & { inEvent: boolean } = { inEvent: false }
 for (const line of unfold(text)) {
  if (line === 'BEGIN:VEVENT') { current = { inEvent: true }; continue }
  if (line === 'END:VEVENT') {
   if (current.inEvent && current.uid !== undefined && current.summary !== undefined && current.start !== undefined) {
    events.push({ uid: current.uid, summary: current.summary, description: current.description ?? null, url: current.url ?? null, start: current.start })
   }
   current = { inEvent: false }
   continue
  }
  if (!current.inEvent) continue
  const prop = property(line)
  if (prop === null) continue
  if (prop.name === 'UID') current.uid = prop.value.trim()
  else if (prop.name === 'SUMMARY') current.summary = unescapeText(prop.value).trim()
  else if (prop.name === 'DESCRIPTION') current.description = unescapeText(prop.value).trim()
  else if (prop.name === 'URL') current.url = prop.value.trim()
  else if (prop.name === 'DTSTART' || (prop.name === 'DUE' && current.start === undefined)) {
   const parts = dateTimeParts(prop.value.trim())
   if (parts === null) continue
   if (prop.params.VALUE === 'DATE' || !prop.value.includes('T')) current.start = { kind: 'date', value: `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}` }
   else if (prop.value.endsWith('Z')) current.start = { kind: 'instant', iso: new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2], parts[3], parts[4], parts[5])).toISOString() }
   else if (prop.params.TZID !== undefined) current.start = { kind: 'instant', iso: zonedInstant(parts, prop.params.TZID).toISOString() }
   else current.start = { kind: 'floating', parts }
  }
 }
 return events
}

/** Canvas summaries end with the course code in brackets: "Homework 3 [CS 180]". */
function splitCourse(summary: string): { title: string; course: string | null } {
 const match = /^(.*?)\s*\[([^\[\]]+)\]\s*$/.exec(summary)
 return match === null ? { title: summary, course: null } : { title: match[1]!.trim() || summary, course: match[2]!.trim() }
}

/** Items in the account's time zone, one per UID, ordered by deadline. */
export function courseItems(events: readonly RawEvent[], timeZone: string): CourseFeedItem[] {
 const byUid = new Map<string, CourseFeedItem>()
 for (const event of events) {
  const { title, course } = splitCourse(event.summary)
  const description = event.description === null || event.description === '' ? null : event.description.slice(0, MAX_DESCRIPTION)
  const existing = byUid.get(event.uid)
  // A repeated UID keeps the fuller copy: fields the first occurrence lacked are filled from the later one.
  const base = { uid: event.uid, title: existing?.title ?? title, course: existing?.course ?? course, url: existing?.url ?? event.url, description: existing?.description ?? description }
  if (existing !== undefined) { byUid.set(event.uid, { ...existing, ...base }); continue }
  if (event.start.kind === 'date') byUid.set(event.uid, { ...base, due_at: null, due_date: event.start.value, all_day: true })
  else {
   const instant = event.start.kind === 'instant' ? new Date(event.start.iso) : zonedInstant(event.start.parts, timeZone)
   byUid.set(event.uid, { ...base, due_at: instant.toISOString(), due_date: localDate(instant, timeZone), all_day: false })
  }
 }
 return [...byUid.values()].sort((left, right) => left.due_date.localeCompare(right.due_date) || (left.due_at ?? '').localeCompare(right.due_at ?? '') || left.title.localeCompare(right.title))
}

export function itemsBetween(items: readonly CourseFeedItem[], from: string, to: string): CourseFeedItem[] {
 return items.filter((item) => item.due_date >= from && item.due_date <= to)
}
