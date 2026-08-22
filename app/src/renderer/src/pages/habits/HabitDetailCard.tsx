import { Flame, Snowflake } from 'lucide-react'
import type { ReactNode } from 'react'

import { familyQtHeatmap } from '../../data/mock'
import {
  MONTH_DAY_COUNT,
  MONTH_LABEL,
  MONTH_LEAD_BLANKS,
  MONTH_LOGGED_THROUGH,
  monthCellsFor
} from './habitModel'
import type { HabitVM } from './habitModel'

export interface HabitDetailCardProps {
  habit: HabitVM
}

const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

function framingFor(habit: HabitVM): string | null {
  if (habit.id === familyQtHeatmap.habitId) {
    return familyQtHeatmap.framing
  }
  if (habit.streak > 0 && habit.streak === habit.bestStreak) {
    return 'The longest run yet.'
  }
  return null
}

/** Persistent rail detail for the selected habit: stats and the August grid. */
export function HabitDetailCard({ habit }: HabitDetailCardProps): ReactNode {
  const cells = monthCellsFor(habit)
  const doneThisMonth = cells.filter((cell) => cell.mark === 'done').length
  const framing = framingFor(habit)

  return (
    <div className="habit-detail ui-card">
      <div className="habit-detail-head">
        <span className="habit-detail-name">{habit.name}</span>
        {habit.gold ? <Flame size={14} className="habit-detail-goldflame" aria-hidden="true" /> : null}
      </div>

      <div className="habit-peek-stats">
        <div className="habit-peek-stat">
          <span className={`habit-peek-stat-value tnum${habit.gold ? ' is-gold' : ''}`}>
            {habit.streak}
          </span>
          <span className="habit-peek-stat-label">Streak</span>
        </div>
        <div className="habit-peek-stat">
          <span className="habit-peek-stat-value tnum">{habit.bestStreak}</span>
          <span className="habit-peek-stat-label">Best</span>
        </div>
        <div className="habit-peek-stat">
          <span className="habit-peek-stat-value tnum">{doneThisMonth}</span>
          <span className="habit-peek-stat-label">This month</span>
        </div>
      </div>

      {framing !== null ? <p className="habit-peek-framing display">{framing}</p> : null}

      <div className="habit-peek-month">
        <span className="habit-peek-month-label">{MONTH_LABEL}</span>
        <div className="habit-month-grid">
          {WEEKDAY_HEADERS.map((letter, index) => (
            <span key={`h-${index}`} className="habit-month-header">
              {letter}
            </span>
          ))}
          {Array.from({ length: MONTH_LEAD_BLANKS }, (_, index) => (
            <span key={`b-${index}`} />
          ))}
          {Array.from({ length: MONTH_DAY_COUNT }, (_, index) => {
            const day = index + 1
            if (day > MONTH_LOGGED_THROUGH) {
              return (
                <span key={day} className="habit-month-cell is-future">
                  <span className="habit-month-daynum tnum">{day}</span>
                </span>
              )
            }
            const cell = cells.find((candidate) => candidate.day === day)
            const mark = cell !== undefined ? cell.mark : 'future'
            return (
              <span key={day} className={`habit-month-cell is-${mark}`}>
                {mark === 'frozen' ? (
                  <Snowflake size={11} />
                ) : (
                  <span className="habit-month-daynum tnum">{day}</span>
                )}
              </span>
            )
          })}
        </div>
        <div className="habit-month-legend">
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-done" /> Done
          </span>
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-frozen" /> Freeze
          </span>
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-missed" /> Missed
          </span>
        </div>
      </div>
    </div>
  )
}
