import { TODAY_ISO } from '../../data/mock'
import type { JobPosting, PipelineEntry, PipelineStage } from '../../data/mock'

/** Board columns. Rejections and offers both land in Decided. */
export type JobColumn = 'applied' | 'oa' | 'interview' | 'decided'

/** What is currently being dragged: a pipeline card, or a to-apply row. */
export type DragPayload =
  | { kind: 'card'; id: string }
  | { kind: 'posting'; id: string }

export interface BoardCard {
  id: string
  company: string
  role: string
  column: JobColumn
  /** Stage detail in product voice, e.g. "OA due Friday". */
  detail: string
  /** OA cards with a deadline get the amber detail treatment. */
  dueSoon: boolean
  /** ISO deadline for OA cards; null otherwise. */
  oaDueDate: string | null
  /** Non-null when the process ended. */
  outcome: 'rejected' | null
  /** Posting URL; empty until set. */
  link: string
  /** Free-form notes; empty until written. */
  notes: string
}

/** A to-apply row with the editable extras the peek exposes. */
export interface LocalPosting extends JobPosting {
  link: string
  notes: string
}

export interface ColumnMeta {
  column: JobColumn
  label: string
  pillColorway: 'forest' | 'today' | 'coral' | 'neutral'
}

export const jobColumns: readonly ColumnMeta[] = [
  { column: 'applied', label: 'Applied', pillColorway: 'forest' },
  { column: 'oa', label: 'OA', pillColorway: 'today' },
  { column: 'interview', label: 'Interviews', pillColorway: 'coral' },
  { column: 'decided', label: 'Decided', pillColorway: 'neutral' }
]

function columnFor(stage: PipelineStage): JobColumn {
  if (stage === 'rejected') {
    return 'decided'
  }
  return stage
}

/** Link and notes seeds for a few pipeline companies; the rest start empty. */
const seededExtras: Readonly<Record<string, { link: string; notes: string }>> = {
  'pl-openai': {
    link: 'https://openai.com/careers/swe-intern',
    notes: 'Referred by Arjun. Nudge him if nothing lands by Labor Day.'
  },
  'pl-databricks': {
    link: 'https://databricks.com/company/careers/swe-intern',
    notes: 'OA is 90 minutes, two problems. Run one timed set before Friday.'
  },
  'pl-vercel': {
    link: 'https://vercel.com/careers',
    notes: 'Round 1 stayed light on systems. Round 2 is the platform team, so review edge caching.'
  }
}

export function toBoardCard(entry: PipelineEntry): BoardCard {
  const extras = seededExtras[entry.id] ?? { link: '', notes: '' }
  return {
    id: entry.id,
    company: entry.company,
    role: entry.role,
    column: columnFor(entry.stage),
    detail: entry.detail,
    dueSoon: entry.stage === 'oa' && entry.dueDate !== null,
    oaDueDate: entry.stage === 'oa' ? entry.dueDate : null,
    outcome: entry.stage === 'rejected' ? 'rejected' : null,
    link: extras.link,
    notes: extras.notes
  }
}

export function toLocalPosting(posting: JobPosting): LocalPosting {
  return { ...posting, link: '', notes: '' }
}

/** Detail line a card gets when it is moved into a column by hand. */
export function detailForMove(column: JobColumn): string {
  switch (column) {
    case 'applied':
      return 'Applied today'
    case 'oa':
      return 'OA waiting'
    case 'interview':
      return 'Scheduling'
    case 'decided':
      return 'Closed'
  }
}

export function ageLabel(ageDays: number): string {
  if (ageDays === 0) {
    return 'Today'
  }
  return `${ageDays}d ago`
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

/** Weekday index of the canonical today (Wednesday, per the mock story). */
const TODAY_WEEKDAY = 3

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split('-').map((part) => Number(part))
  return Math.round(new Date(year, month - 1, day).getTime() / 86_400_000)
}

/**
 * "2026-08-22" -> "Friday, Aug 22". Weekdays follow the canonical story's
 * calendar (today is Wednesday, August 20), not the real 2026 calendar.
 */
function formatIsoDay(iso: string): string {
  const [, month, day] = iso.split('-').map((part) => Number(part))
  const diff = dayNumber(iso) - dayNumber(TODAY_ISO)
  const weekday = WEEKDAYS[((TODAY_WEEKDAY + diff) % 7 + 7) % 7]
  const monthShort = new Date(2026, month - 1, 1).toLocaleDateString('en-US', { month: 'short' })
  return `${weekday}, ${monthShort} ${day}`
}

export interface PeekDateRow {
  label: string
  value: string
  /** Quiet placeholder styling for unset values. */
  muted: boolean
}

/** The key dates a card's stage makes relevant, as read-only property rows. */
export function dateRowsFor(card: BoardCard): readonly PeekDateRow[] {
  switch (card.column) {
    case 'applied': {
      const value = card.detail.startsWith('Applied ') ? card.detail.slice(8) : 'Today'
      return [{ label: 'Applied', value: value === 'today' ? 'Today' : value, muted: false }]
    }
    case 'oa':
      return [
        card.oaDueDate !== null
          ? { label: 'OA due', value: formatIsoDay(card.oaDueDate), muted: false }
          : { label: 'OA due', value: 'Not set', muted: true }
      ]
    case 'interview':
      return [{ label: 'Interview', value: card.detail, muted: false }]
    case 'decided':
      return [
        {
          label: 'Outcome',
          value: card.outcome === 'rejected' ? 'Rejected' : 'Closed',
          muted: false
        }
      ]
  }
}
