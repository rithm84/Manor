import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Flame,
  Info,
  Pause,
  Pencil,
  Play,
  Snowflake,
  Trash2
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../../components/ui'
import { markForDate } from '../../../../shared/habits'
import type { HabitsState } from '../../../../shared/habits'
import { daysInMonth, monthLabel, monthShift } from './habitModel'
import type { HabitViewModel } from './habitModel'

export interface HabitDetailCardProps {
  state: HabitsState
  habit: HabitViewModel
  month: string
  onMonthChange: (month: string) => void
  onEdit: () => void
  onPause: () => void
  onResume: () => void
  onRetire: () => void
  onDelete: () => void
}

const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

function leadBlanks(month: string): number {
  const weekday = new Date(`${month}-01T00:00:00.000Z`).getUTCDay()
  return weekday === 0 ? 6 : weekday - 1
}

export function HabitDetailCard({
  state,
  habit,
  month,
  onMonthChange,
  onEdit,
  onPause,
  onResume,
  onRetire,
  onDelete
}: HabitDetailCardProps): ReactNode {
  const { definition, metrics, status } = habit
  const dayCount = daysInMonth(month)
  const dates = Array.from(
    { length: dayCount },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
  )
  const completeThisMonth = dates.filter(
    (date) => markForDate(state, definition, date) === 'complete'
  ).length
  const nextMonth = monthShift(month, 1)
  const canMoveForward = nextMonth <= state.today.slice(0, 7)

  return (
    <div className="habit-detail">
      <div className="habit-detail-identity">
        <div className="habit-detail-titleline">
          <h2>{definition.name}</h2>
          {metrics.gold ? <Flame size={17} className="habit-detail-goldflame" aria-label="Violet streak" /> : null}
        </div>
        <span className="habit-detail-kind">
          {definition.kind === 'binary' ? 'One tap' : `In quarters to ${definition.targetLabel}`}
          {status !== 'active' ? ` · ${status === 'paused' ? 'Paused' : 'Retired'}` : ''}
        </span>
      </div>

      <div className="habit-detail-stats">
        <div className="habit-detail-stat">
          <span className={`habit-detail-stat-value tnum${metrics.gold ? ' is-gold' : ''}`}>
            {metrics.currentStreak}
          </span>
          <span className="habit-detail-stat-label">Current streak</span>
        </div>
        <div className="habit-detail-stat">
          <span className="habit-detail-stat-value tnum">{metrics.bestStreak}</span>
          <span className="habit-detail-stat-label">Best streak</span>
        </div>
        <div className="habit-detail-stat">
          <span className="habit-detail-stat-value tnum">{metrics.completionRate}%</span>
          <span className="habit-detail-stat-label">All time</span>
        </div>
      </div>

      <section className="habit-detail-section">
        <div className="habit-detail-sectionhead">
          <div>
            <span className="habit-detail-sectiontitle">{monthLabel(month)}</span>
            <span className="habit-detail-sectionmeta tnum">{completeThisMonth} completed</span>
          </div>
          <span className="habit-month-nav">
            <button
              type="button"
              className="habit-row-iconbtn"
              aria-label="Previous month"
              onClick={() => onMonthChange(monthShift(month, -1))}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="habit-row-iconbtn"
              aria-label="Next month"
              disabled={!canMoveForward}
              onClick={() => onMonthChange(nextMonth)}
            >
              <ChevronRight size={15} />
            </button>
          </span>
        </div>

        <div className="habit-month-grid">
          {WEEKDAY_HEADERS.map((letter, index) => (
            <span key={`header-${index}`} className="habit-month-header">
              {letter}
            </span>
          ))}
          {Array.from({ length: leadBlanks(month) }, (_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {dates.map((date, index) => {
            const mark = markForDate(state, definition, date)
            return (
              <span
                key={date}
                className={`habit-month-cell is-${mark}`}
                title={`${date}: ${mark}`}
              >
                {mark === 'frozen' ? (
                  <Snowflake size={11} />
                ) : (
                  <span className="habit-month-daynum tnum">{index + 1}</span>
                )}
              </span>
            )
          })}
        </div>
        <div className="habit-month-legend">
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-complete" /> Complete
          </span>
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-frozen" /> Freeze
          </span>
          <span className="habit-month-legend-item">
            <span className="habit-month-swatch is-missed" /> Missed
          </span>
        </div>
      </section>

      <details className="habit-rules">
        <summary>
          <Info size={14} /> How this streak works
        </summary>
        <div className="habit-rules-body">
          <p>A freeze is spent automatically when this habit misses a day.</p>
          <p>Seven completed days without a freeze turn the flame violet.</p>
          <p>After a break, two clean days within 48 hours can restore the streak once this month.</p>
          {metrics.earnBackUsedThisMonth ? <p>Earn-Back has been used this month.</p> : null}
        </div>
      </details>

      <section className="habit-detail-actions">
        {status !== 'retired' ? (
          <Button variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>
            Edit habit
          </Button>
        ) : null}
        {status === 'active' ? (
          <Button variant="ghost" icon={<Pause size={14} />} onClick={onPause}>
            Pause
          </Button>
        ) : status === 'paused' ? (
          <Button variant="ghost" icon={<Play size={14} />} onClick={onResume}>
            Resume
          </Button>
        ) : null}
      </section>

      {status !== 'retired' ? (
        <section className="habit-retire-zone">
          <div>
            <span className="habit-retire-title">Retire habit</span>
            <span className="habit-retire-copy">Retiring removes it from daily logging and keeps every entry.</span>
          </div>
          <Button variant="subtle" icon={<Archive size={14} />} onClick={onRetire}>
            Retire
          </Button>
        </section>
      ) : null}

      {habit.canDelete ? (
        <button type="button" className="habit-delete" onClick={onDelete}>
          <Trash2 size={13} /> Delete permanently
        </button>
      ) : null}
    </div>
  )
}
