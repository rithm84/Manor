import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { StreakFlame } from '../../components/ui'
import type { StreakFlameState } from '../../components/ui'
import type { HabitWeekDay } from './habitModel'

export interface WeekStripProps {
  atRisk: boolean
  gold: boolean
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

export function streakFlameState(streak: number, atRisk: boolean, gold: boolean): StreakFlameState {
  if (streak === 0) return 'ember'
  if (atRisk) return 'dim'
  return gold ? 'blazing' : 'lit'
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

/** Compact Mon-to-Sun state rail with the streak flame and detail navigation. */
export function WeekStrip({
  atRisk,
  gold,
  habitId,
  habitName,
  onOpen,
  streak,
  week
}: WeekStripProps): ReactNode {
  const flameState = streakFlameState(streak, atRisk, gold)

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
      <span className={`habit-week-streak tnum is-${flameState}`} aria-hidden="true">
        <StreakFlame size={22} state={flameState} />
        {streak}
      </span>
      <ChevronRight className="habit-week-chevron" size={13} aria-hidden="true" />
    </button>
  )
}
