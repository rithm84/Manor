import { Archive, ChevronLeft, ChevronRight, Snowflake } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import type { HabitsState } from '../../../../shared/habits'
import {
  historyMonthAfterNavigation,
  monthShift,
  monthSummary,
  twelveMonthTrend
} from './habitModel'
import type { HabitMonthRow } from './habitModel'
import './habitHistory.css'

export interface HabitHistoryProps {
  state: HabitsState
  month: string
  onMonthChange: (month: string) => void
  onOpenHabit: (habitId: string) => void
}

function statusLabel(status: 'active' | 'paused' | 'retired' | null): string | null {
  if (status === 'active' || status === null) return null
  return status === 'paused' ? 'Paused' : 'Retired'
}

export interface HabitPerformanceSlice {
  key: 'complete' | 'partial' | 'frozen' | 'missed' | 'pending' | 'untracked'
  label: string
  value: number
  fill: string
}

export interface HabitDonutPresentation {
  slices: readonly HabitPerformanceSlice[]
  seamlessFill: string | null
}

function markCount(row: HabitMonthRow, mark: HabitMonthRow['days'][number]): number {
  return row.days.filter((day) => day === mark).length
}

export function habitPerformanceSlices(row: HabitMonthRow): readonly HabitPerformanceSlice[] {
  if (row.trackedDays === 0) {
    return [{ key: 'untracked', label: 'No tracked days', value: 1, fill: 'var(--surface-soft)' }]
  }

  const slices: readonly HabitPerformanceSlice[] = [
    {
      key: 'complete',
      label: 'Complete',
      value: row.completedDays,
      fill: 'var(--completion)'
    },
    {
      key: 'partial',
      label: 'Partial',
      value: row.partialDays,
      fill: 'var(--today-warning)'
    },
    {
      key: 'frozen',
      label: 'Frozen',
      value: row.frozenDays,
      fill: 'var(--frozen-info)'
    },
    {
      key: 'missed',
      label: 'Missed',
      value: markCount(row, 'missed'),
      fill: 'var(--overdue-error)'
    },
    {
      key: 'pending',
      label: 'Pending',
      value: markCount(row, 'pending'),
      fill: 'var(--surface-strong)'
    }
  ]
  return slices.filter((slice) => slice.value > 0)
}

export function habitPerformanceLabel(row: HabitMonthRow): string {
  const lifecycleLabel = statusLabel(row.status)
  const status = lifecycleLabel === null ? '' : ` ${lifecycleLabel}.`
  const states = habitPerformanceSlices(row)
    .filter((slice) => slice.key !== 'untracked')
    .map((slice) => `${slice.value} ${slice.label.toLowerCase()}`)
    .join(', ')
  const breakdown = states === '' ? 'No tracked days.' : `${states}.`
  return `${row.habit.name}.${status} ${row.completionRate}% complete. ${breakdown} Open details.`
}

export function habitDonutPresentation(row: HabitMonthRow): HabitDonutPresentation {
  const slices = habitPerformanceSlices(row)
  return {
    slices,
    seamlessFill: slices.length === 1 ? (slices[0]?.fill ?? null) : null
  }
}

export function HabitPerformanceDonut({ row }: { row: HabitMonthRow }): ReactNode {
  const presentation = habitDonutPresentation(row)

  return (
    <span className="habit-history-rankdonut" aria-hidden="true">
      {presentation.seamlessFill !== null ? (
        <svg
          className="habit-history-seamless-ring"
          viewBox="0 0 52 52"
          shapeRendering="geometricPrecision"
        >
          <circle
            cx="26"
            cy="26"
            fill="none"
            r="19"
            stroke={presentation.seamlessFill}
            strokeWidth="8"
          />
        </svg>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={presentation.slices}
              dataKey="value"
              innerRadius={15}
              isAnimationActive={false}
              outerRadius={23}
              paddingAngle={1.5}
              stroke="var(--surface-card)"
              strokeWidth={1}
            >
              {presentation.slices.map((slice) => (
                <Cell key={slice.key} fill={slice.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
      <span className="habit-history-rankrate tnum">{row.completionRate}%</span>
    </span>
  )
}

export function HabitHistory({
  state,
  month,
  onMonthChange,
  onOpenHabit
}: HabitHistoryProps): ReactNode {
  const summary = monthSummary(state, month)
  const trend = twelveMonthTrend(state, month)
  const nextMonth = historyMonthAfterNavigation(month, 1, state.today)
  const canMoveForward = nextMonth !== month
  const averageCompletion = Math.round(
    trend.reduce((total, item) => total + item.completionRate, 0) / trend.length
  )
  const rankedRows = [...summary.rows].sort(
    (left, right) =>
      right.completionRate - left.completionRate || left.habit.name.localeCompare(right.habit.name)
  )

  return (
    <div className="habit-history">
      <section className="habit-history-topline">
        <h2>Progress over time</h2>
        <div className="habit-history-monthnav" role="group" aria-label="History month">
          <button
            type="button"
            className="habit-history-navbutton"
            aria-label="Previous month"
            onClick={() => onMonthChange(monthShift(month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="habit-history-monthlabel" aria-live="polite">
            {summary.label}
          </span>
          <button
            type="button"
            className="habit-history-navbutton"
            aria-label="Next month"
            disabled={!canMoveForward}
            onClick={() => onMonthChange(nextMonth)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </section>

      <section className="habit-history-summary" aria-label={`${summary.label} summary`}>
        <div className="habit-history-summary-primary">
          <span className="habit-history-summaryvalue tnum">{summary.completionRate}%</span>
          <span className="habit-history-summarylabel">Completed</span>
        </div>
        <div>
          <span className="habit-history-summaryvalue tnum">{summary.perfectDays}</span>
          <span className="habit-history-summarylabel">Perfect days</span>
        </div>
        <div>
          <span className="habit-history-summaryvalue tnum">{summary.frozenDays}</span>
          <span className="habit-history-summarylabel">Freezes used</span>
        </div>
        <div>
          <span className="habit-history-summaryvalue tnum">{summary.rows.length}</span>
          <span className="habit-history-summarylabel">Habits in view</span>
        </div>
      </section>

      <section className="habit-history-trend" aria-labelledby="habit-history-trend-title">
        <div className="habit-history-sectionhead">
          <div>
            <h3 id="habit-history-trend-title">12-month completion</h3>
            <p>Full completions across all tracked habits.</p>
          </div>
          <div className="habit-history-trendstat">
            <span className="tnum">{averageCompletion}%</span>
            <span>12-month average</span>
          </div>
        </div>

        <div
          className="habit-history-chart"
          role="img"
          aria-label={`Monthly habit completion ending ${summary.label}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={trend}
              margin={{ top: 12, right: 8, bottom: 0, left: -8 }}
            >
              <defs>
                <linearGradient id="habit-history-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--completion)" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="var(--completion)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="2 4" />
              <XAxis
                axisLine={false}
                dataKey="shortLabel"
                tick={{ fill: 'var(--ink-muted)', fontSize: 10 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={[0, 100]}
                tick={{ fill: 'var(--ink-muted)', fontSize: 10 }}
                tickFormatter={(value: number) => `${value}%`}
                tickLine={false}
                ticks={[0, 25, 50, 75, 100]}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow-overlay)',
                  color: 'var(--ink-body)',
                  fontSize: 12
                }}
                cursor={{ stroke: 'var(--surface-strong)', strokeWidth: 1 }}
                formatter={(value) => [`${String(value)}%`, 'Completed']}
                isAnimationActive={false}
                labelStyle={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 4 }}
              />
              <Area
                activeDot={{
                  fill: 'var(--surface-card)',
                  r: 4,
                  stroke: 'var(--completion)',
                  strokeWidth: 2
                }}
                dataKey="completionRate"
                dot={{
                  fill: 'var(--surface-card)',
                  r: 2.5,
                  stroke: 'var(--completion)',
                  strokeWidth: 1.5
                }}
                fill="url(#habit-history-fill)"
                isAnimationActive={false}
                name="Completed"
                stroke="var(--completion)"
                strokeWidth={2}
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="habit-history-breakdown" aria-labelledby="habit-history-breakdown-title">
        <div className="habit-history-sectionhead">
          <div>
            <h3 id="habit-history-breakdown-title">Habit performance</h3>
            <p>Completed days among days tracked in {summary.label}.</p>
          </div>
          <div className="habit-history-donutlegend" aria-label="Performance chart legend">
            <span>
              <span className="habit-history-legenddot is-complete" aria-hidden="true" />
              Complete
            </span>
            <span>
              <span className="habit-history-legenddot is-partial" aria-hidden="true" />
              Partial
            </span>
            <span>
              <span className="habit-history-legenddot is-frozen" aria-hidden="true" />
              Freeze
            </span>
            <span>
              <span className="habit-history-legenddot is-missed" aria-hidden="true" />
              Missed
            </span>
          </div>
        </div>

        <ol className="habit-history-ranking">
          {rankedRows.map((row, index) => {
            const lifecycleLabel = statusLabel(row.status)
            const missedDays = markCount(row, 'missed')
            return (
              <li key={row.habit.id}>
                <button
                  type="button"
                  className="habit-history-rankrow"
                  aria-label={habitPerformanceLabel(row)}
                  data-testid={`habit-history-row-${row.habit.id}`}
                  onClick={() => onOpenHabit(row.habit.id)}
                >
                  <span className="habit-history-rank tnum" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="habit-history-rankidentity">
                    <span className="habit-history-ranktitle">
                      <span>{row.habit.name}</span>
                      {lifecycleLabel !== null ? (
                        <span className="habit-history-lifecycle">
                          {lifecycleLabel === 'Retired' ? <Archive size={11} /> : null}
                          {lifecycleLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="habit-history-rankmeta">
                      <span className="tnum">
                        {row.completedDays} of {row.trackedDays} days
                      </span>
                      {row.partialDays > 0 ? <span>{row.partialDays} partial</span> : null}
                      {row.frozenDays > 0 ? (
                        <span className="habit-history-freezecount">
                          <Snowflake size={11} /> {row.frozenDays}
                        </span>
                      ) : null}
                      {missedDays > 0 ? <span>{missedDays} missed</span> : null}
                    </span>
                  </span>
                  <HabitPerformanceDonut row={row} />
                  <ChevronRight className="habit-history-rankchevron" size={14} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
