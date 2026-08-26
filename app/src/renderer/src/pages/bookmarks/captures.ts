import type { KbEntry } from '../../../../shared/kb'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

/** Hostname of the entry's source URL, without a www. prefix; null when absent or unparsable. */
export function captureHost(url: string | null): string | null {
  if (url === null) {
    return null
  }
  try {
    const host = new URL(url).hostname
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

/** Display title: the normalized title, else the URL host (while pending), else a plain fallback. */
export function captureTitle(entry: KbEntry): string {
  if (entry.title !== null && entry.title.trim() !== '') {
    return entry.title
  }
  const host = captureHost(entry.url)
  if (host !== null) {
    return host
  }
  return 'Screen capture'
}

/** Clock time for today's captures, short date otherwise, year only when it differs. */
export function captureTimeLabel(capturedAt: string, now: Date): string {
  const date = new Date(capturedAt)
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    const hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const meridiem = hours >= 12 ? 'PM' : 'AM'
    const clockHours = hours % 12 === 0 ? 12 : hours % 12
    return `${clockHours}:${minutes} ${meridiem}`
  }
  const dayLabel = `${MONTHS[date.getMonth()]} ${date.getDate()}`
  return date.getFullYear() === now.getFullYear() ? dayLabel : `${dayLabel}, ${date.getFullYear()}`
}

export function hasPendingCaptures(entries: readonly KbEntry[]): boolean {
  return entries.some((entry) => entry.status === 'pending')
}

/** Search-box match over title, author, summary, and URL. An empty query matches everything. */
export function matchesCaptureQuery(entry: KbEntry, lowerQuery: string): boolean {
  if (lowerQuery === '') {
    return true
  }
  const haystack = [entry.title, entry.author, entry.summary, entry.url]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()
  return haystack.includes(lowerQuery)
}
