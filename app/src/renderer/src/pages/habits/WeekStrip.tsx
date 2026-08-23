import { ChevronRight, Flame } from 'lucide-react'
import type { ReactNode } from 'react'

import type { HabitWeekDay } from './habitModel'

export interface WeekStripProps {
  atRisk: boolean
  habitId: string
  habitName: string
  onOpen: () => void
  streak: number
  week: readonly HabitWeekDay[]
}

function accessibleMarkLabel(mark: HabitWeekDay['mark']): string {
  if (mark === 'complete') return 'complete'
  if (mark === 'partial') return 'partial'
  if (mark === 'frozen') return 'frozen'
  if (mark === 'missed') return 'missed'
  if (mark === 'pending') return 'pending'
  if (mark === 'paused') return 'paused'
  if (mark === 'inactive') return 'inactive'
  return 'upcoming'
}

export function weekProgressLabel(
  habitName: string,
  week: readonly HabitWeekDay[],
  streak: number,
  atRisk: boolean
): string {
  const days = week
    .map(
      (day) =>
        `${day.letter} ${accessibleMarkLabel(day.mark)}${day.selected ? ', selected' : ''}`
    )
    .join('; ')
  const risk = atRisk ? ' At risk today.' : ''
  return `${habitName}. This week: ${days}. ${streak}-day streak.${risk} Open details.`
}

/** Compact Mon-to-Sun state rail with streak and detail navigation. */
export function WeekStrip({
  atRisk,
  habitId,
  habitName,
  onOpen,
  streak,
  week
}: WeekStripProps): ReactNode {
  return (
    <button
      type="button"
      className={`habit-week-progress${atRisk ? ' is-atrisk' : ''}`}
      aria-label={weekProgressLabel(habitName, week, streak, atRisk)}
      data-testid={`habit-week-progress-${habitId}`}
      onClick={onOpen}
    >
      <span className="habit-week-rail" aria-hidden="true">
        {week.map((day) => (
          <span key={day.date} className={`habit-week-day${day.selected ? ' is-selected' : ''}`}>
            <span className="habit-week-label">{day.letter}</span>
            <span className={`habit-week-segment is-${day.mark}`} />
          </span>
        ))}
      </span>
      <span className="habit-week-streak tnum" aria-hidden="true">
        <Flame size={12} />
        {streak}
      </span>
      <ChevronRight className="habit-week-chevron" size={13} aria-hidden="true" />
    </button>
  )
}
