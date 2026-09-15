import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatMinutes } from '../../../shared/pomodoro'
import type { PomodoroMonthStats } from '../../../shared/pomodoro'
import { monthLabel, shortDayLabel } from './pomodoroModel'

export interface MonthStatsProps {
  stats: PomodoroMonthStats
  today: string
  canMoveBack: boolean
  canMoveForward: boolean
  onMonthChange: (direction: -1 | 1) => void
  /** The id of the session that just completed, so the count can pop once. */
  pop: string | null
}

interface ChartPoint {
  date: string
  day: number
  minutes: number
  completed: number
  isToday: boolean
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload: ChartPoint }[] }): ReactNode {
  if (!active || payload === undefined || payload.length === 0) return null
  const point = payload[0].payload
  return (
    <div className="pomo-chart-tip">
      <strong>{shortDayLabel(point.date)}</strong>
      <span className="tnum">{point.completed === 0 ? 'No sessions' : `${point.completed} ${point.completed === 1 ? 'session' : 'sessions'}`}</span>
      {point.minutes > 0 ? <span className="tnum">{formatMinutes(point.minutes * 60)} focused</span> : null}
    </div>
  )
}

export function MonthStats({ stats, today, canMoveBack, canMoveForward, onMonthChange, pop }: MonthStatsProps): ReactNode {
  const label = monthLabel(stats.month)
  const points: ChartPoint[] = stats.days.map((day) => ({
    date: day.date, day: Number(day.date.slice(8, 10)), minutes: Math.round(day.focusedSeconds / 60), completed: day.completed, isToday: day.date === today
  }))
  const ticks = points.filter((point) => point.day === 1 || point.day % 5 === 0).map((point) => point.day)
  const perActiveDay = stats.activeDays === 0 ? null : Math.round((stats.completed / stats.activeDays) * 10) / 10

  return (
    <section className="pomo-month" aria-labelledby="pomo-month-title">
      <div className="pomo-topline">
        <div>
          <h2 id="pomo-month-title">{label}</h2>
          <p>
            {stats.completed === 0
              ? 'No focus sessions yet this month.'
              : stats.bestDay === null
                ? `${stats.completed} sessions.`
                : `Best day ${shortDayLabel(stats.bestDay.date)} with ${stats.bestDay.completed} ${stats.bestDay.completed === 1 ? 'session' : 'sessions'}.`}
          </p>
        </div>
        <div className="pomo-monthnav" role="group" aria-label="Statistics month">
          <button type="button" aria-label="Previous month" disabled={!canMoveBack} onClick={() => onMonthChange(-1)}><ChevronLeft size={16} /></button>
          <span aria-live="polite">{label}</span>
          <button type="button" aria-label="Next month" disabled={!canMoveForward} onClick={() => onMonthChange(1)}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="pomo-summary" aria-label={`${label} summary`}>
        <div className="pomo-summary-primary">
          <span key={pop ?? 'steady'} className={`pomo-summary-value tnum${pop !== null ? ' is-popping' : ''}`}>{stats.completed}</span>
          <span className="pomo-summary-label">Sessions completed</span>
        </div>
        <div>
          <span className="pomo-summary-value tnum">{formatMinutes(stats.focusedSeconds)}</span>
          <span className="pomo-summary-label">Focused</span>
        </div>
        <div>
          <span className="pomo-summary-value tnum">{stats.activeDays}<span className="pomo-summary-of"> of {stats.elapsedDays}</span></span>
          <span className="pomo-summary-label">Active days</span>
        </div>
        <div>
          <span className="pomo-summary-value tnum">{perActiveDay === null ? '0' : perActiveDay}</span>
          <span className="pomo-summary-label">Per active day</span>
        </div>
        <div>
          <span className="pomo-summary-value tnum">{stats.streak}</span>
          <span className="pomo-summary-label">Day streak</span>
        </div>
      </div>

      <div className="pomo-chart" role="img" aria-label={`Minutes focused each day of ${label}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={points} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="2 4" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} ticks={ticks} tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} width={40} allowDecimals={false} tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} tickFormatter={(value: number) => `${value}m`} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-soft)' }} isAnimationActive={false} />
            <Bar dataKey="minutes" isAnimationActive={false} radius={[3, 3, 0, 0]} minPointSize={0}>
              {points.map((point) => <Cell key={point.date} fill={point.isToday ? 'var(--primary)' : 'var(--pomo-bar)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
