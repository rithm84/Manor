import { GripVertical } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import type { HabitsState } from '../../../shared/habits'
import { FreezeCrystal, MonthNav, Select } from '../../components/ui'
import { useDeviceFlag, useDevicePreference } from '../../preferences/devicePreference'
import {
  earliestHistoryMonth,
  habitTrend,
  historyMonthAfterNavigation,
  monthShift,
  monthSummary,
  reorderedHabitIds
} from './habitModel'
import type { HabitMonthRow, HabitTrendRange } from './habitModel'
import './habitHistory.css'

export interface HabitHistoryProps {
  state: HabitsState
  month: string
  onMonthChange: (month: string) => void
  onOpenHabit: (habitId: string) => void
  /** Saves a new habit order (every habit ID once); tiles drag into place only when sorted by your order. */
  onReorder?: (order: readonly string[]) => void
}

export type HabitTileSort = 'order' | 'rate' | 'name'

const TILE_SORTS: readonly HabitTileSort[] = ['order', 'rate', 'name']

const TILE_SORT_OPTIONS = [
  { value: 'order', label: 'Your order' },
  { value: 'rate', label: 'Completion' },
  { value: 'name', label: 'Name' }
] as const

function statusLabel(status: 'active' | 'paused' | 'retired' | null): string | null {
  return status === 'paused' ? 'Paused' : status === 'retired' ? 'Archived' : null
}

/** Rows in the chosen order. Your order is the saved habit order, which the daily list shares. */
export function sortHabitRows(rows: readonly HabitMonthRow[], sort: HabitTileSort): HabitMonthRow[] {
  const sorted = [...rows]
  if (sort === 'rate') {
    sorted.sort((left, right) => right.completionRate - left.completionRate || left.habit.name.localeCompare(right.habit.name))
  } else if (sort === 'name') {
    sorted.sort((left, right) => left.habit.name.localeCompare(right.habit.name))
  }
  return sorted
}


export interface HabitPerformanceSlice {
  key: 'complete' | 'partial' | 'frozen' | 'missed' | 'untracked'
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
      fill: 'var(--completion-soft)'
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

const RING_SIZE = 120
const RING_RADIUS = 52
const RING_STROKE = 11
const RING_GAP = 3
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export interface HabitRingArc {
  key: HabitPerformanceSlice['key']
  fill: string
  /** Visible arc length in viewBox units, after the gap between neighbors. */
  length: number
  /** Distance from the top of the ring to the start of the arc, in viewBox units. */
  offset: number
}

/** Lays slices clockwise from twelve o'clock with a fixed gap between neighbors. */
export function habitRingArcs(slices: readonly HabitPerformanceSlice[]): readonly HabitRingArc[] {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (total === 0) return []
  const gap = slices.length > 1 ? RING_GAP : 0
  let cursor = 0
  return slices.map((slice) => {
    const span = (slice.value / total) * RING_CIRCUMFERENCE
    const arc = {
      key: slice.key,
      fill: slice.fill,
      length: Math.max(span - gap, 0),
      offset: cursor + gap / 2
    }
    cursor += span
    return arc
  })
}

/**
 * The month's tracked days as a ring, with the completion rate in the center.
 * Drawn as stroked circles so single-state months stay a seamless band.
 */
export function HabitPerformanceDonut({ row }: { row: HabitMonthRow }): ReactNode {
  const presentation = habitDonutPresentation(row)
  const center = RING_SIZE / 2

  return (
    <span className="habit-history-donut" aria-hidden="true">
      <svg
        className={presentation.seamlessFill !== null
          ? 'habit-history-ring habit-history-seamless-ring'
          : 'habit-history-ring'}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        shapeRendering="geometricPrecision"
      >
        {presentation.seamlessFill !== null ? (
          <circle
            cx={center}
            cy={center}
            fill="none"
            r={RING_RADIUS}
            stroke={presentation.seamlessFill}
            strokeWidth={RING_STROKE}
          />
        ) : (
          habitRingArcs(presentation.slices).map((arc) => (
            <circle
              key={arc.key}
              cx={center}
              cy={center}
              fill="none"
              r={RING_RADIUS}
              stroke={arc.fill}
              strokeWidth={RING_STROKE}
              strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={-arc.offset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          ))
        )}
      </svg>
      <span className="habit-history-donutrate tnum">{row.completionRate}%</span>
    </span>
  )
}

export function HabitHistory({
  state,
  month,
  onMonthChange,
  onOpenHabit,
  onReorder
}: HabitHistoryProps): ReactNode {
  const [trendRange, setTrendRange] = useState<HabitTrendRange>(6)
  const [trendHabitId, setTrendHabitId] = useState<string | null>(null)
  const [tileSort, setTileSort] = useDevicePreference<HabitTileSort>('habits.history.sort', TILE_SORTS, 'order')
  const [showArchived, setShowArchived] = useDeviceFlag('habits.history.archived', false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const summary = monthSummary(state, month)
  const trend = habitTrend(state, month, trendRange, trendHabitId)
  const nextMonth = historyMonthAfterNavigation(month, 1, state.today)
  const canMoveForward = nextMonth !== month
  const canMoveBack = month > earliestHistoryMonth(state)
  const currentMonth = state.today.slice(0, 7)
  const trendCompleted = trend.reduce((total, item) => total + item.completedDays, 0)
  const trendTracked = trend.reduce((total, item) => total + item.trackedDays, 0)
  const averageCompletion = trendTracked === 0
    ? null
    : Math.round((trendCompleted / trendTracked) * 100)
  const selectedHabit = trendHabitId === null
    ? null
    : state.habits.find((habit) => habit.id === trendHabitId) ?? null
  const archivedCount = summary.rows.filter((row) => row.status === 'retired').length
  const visibleRows = showArchived ? summary.rows : summary.rows.filter((row) => row.status !== 'retired')
  const habitOptions = [
    { value: 'all', label: 'All habits' },
    ...visibleRows.map((row) => ({ value: row.habit.id, label: row.habit.name }))
  ]
  const rankedRows = sortHabitRows(visibleRows, tileSort)
  const canDrag = tileSort === 'order' && onReorder !== undefined && rankedRows.length > 1
  const endDrag = (): void => {
    setArmedId(null)
    setDragId(null)
    setOverId(null)
  }
  const drop = (targetId: string): void => {
    if (dragId === null || onReorder === undefined) return
    const order = reorderedHabitIds(state.habits.map((habit) => habit.id), dragId, targetId)
    if (order !== null) onReorder(order)
  }

  return (
    <div className="habit-history">
      <section className="habit-history-topline">
        <h2>Progress over time</h2>
        <MonthNav
          label="History month"
          monthLabel={summary.label}
          canMoveBack={canMoveBack}
          canMoveForward={canMoveForward}
          onShift={(direction) => onMonthChange(direction === 1 ? nextMonth : monthShift(month, -1))}
          onCurrent={month === currentMonth ? null : () => onMonthChange(currentMonth)}
        />
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
          <span className="habit-history-summaryvalue tnum">{visibleRows.length}</span>
          <span className="habit-history-summarylabel">Habits in view</span>
        </div>
      </section>

      <section className="habit-history-trend" aria-labelledby="habit-history-trend-title">
        <div className="habit-history-sectionhead">
          <div>
            <h3 id="habit-history-trend-title">{trendRange}-month completion</h3>
            <p>{selectedHabit === null ? 'Across all habits.' : `For ${selectedHabit.name}.`}</p>
          </div>
          <div className="habit-history-trendcontrols">
            <Select
              value={trendHabitId ?? 'all'}
              options={habitOptions}
              onChange={(value) => setTrendHabitId(value === 'all' ? null : value)}
              placeholder="All habits"
              ariaLabel="Habit trend scope"
            />
            <div className="habit-history-range" role="group" aria-label="Trend range">
              {([3, 6, 12] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  className={trendRange === range ? 'is-selected' : ''}
                  aria-label={`Show ${range} months`}
                  aria-pressed={trendRange === range}
                  onClick={() => setTrendRange(range)}
                >
                  {range}m
                </button>
              ))}
            </div>
            <div className="habit-history-trendstat">
              <span className="tnum">{averageCompletion === null ? '—' : `${averageCompletion}%`}</span>
              <span>{trendTracked === 0 ? 'No tracked days' : `${trendCompleted} of ${trendTracked} completed`}</span>
            </div>
          </div>
        </div>

        <div
          className="habit-history-chart"
          role="img"
          aria-label={`${trendRange}-month habit completion ending ${summary.label}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              accessibilityLayer
              data={trend}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
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
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                domain={[0, 100]}
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
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
                connectNulls={false}
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
          <div className="habit-history-sectionside">
          {rankedRows.length > 0 ? <div className="habit-history-donutlegend" aria-label="Performance chart legend">
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
          </div> : null}
          <div className="habit-history-tilecontrols">
            {archivedCount > 0 || showArchived ? (
              <button
                type="button"
                className="habit-history-archivedtoggle"
                aria-pressed={showArchived}
                onClick={() => setShowArchived(!showArchived)}
              >
                Archived{archivedCount > 0 ? <span className="tnum">{archivedCount}</span> : null}
              </button>
            ) : null}
            <Select
              value={tileSort}
              options={TILE_SORT_OPTIONS}
              onChange={(value) => setTileSort(value as HabitTileSort)}
              placeholder="Sort"
              ariaLabel="Sort habits"
            />
          </div>
          </div>
        </div>

        {rankedRows.length === 0 ? <p className="habit-history-empty">{summary.rows.length > 0 ? 'Every habit this month is archived.' : 'No habits tracked this month.'}</p> : <ul className={`habit-history-tiles${dragId !== null ? ' is-dragging' : ''}`}>
          {rankedRows.map((row) => {
            const lifecycleLabel = statusLabel(row.status)
            const missedDays = markCount(row, 'missed')
            const id = row.habit.id
            return (
              <li
                key={id}
                data-habit-id={id}
                className={`${dragId === id ? 'is-dragged' : ''}${overId === id && dragId !== null && dragId !== id ? ' is-dropover' : ''}`}
                draggable={canDrag && armedId === id}
                onDragStart={(event) => {
                  if (armedId !== id) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.effectAllowed = 'move'
                  setDragId(id)
                }}
                onDragEnd={endDrag}
                onDragOver={(event) => {
                  if (dragId === null) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (overId !== id) setOverId(id)
                }}
                onDragLeave={() => { if (overId === id) setOverId(null) }}
                onDrop={(event) => {
                  event.preventDefault()
                  drop(id)
                  endDrag()
                }}
              >
                {canDrag ? (
                  <button
                    type="button"
                    className="habit-history-grip"
                    aria-label={`Reorder ${row.habit.name}`}
                    onPointerDown={() => setArmedId(id)}
                    onPointerUp={() => setArmedId(null)}
                    onKeyDown={(event) => {
                      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
                      if (step === 0) return
                      event.preventDefault()
                      const index = rankedRows.findIndex((candidate) => candidate.habit.id === id)
                      const neighbour = rankedRows[index + step]
                      const list = event.currentTarget.closest('ul')
                      if (neighbour !== undefined) {
                        const order = reorderedHabitIds(state.habits.map((habit) => habit.id), id, neighbour.habit.id)
                        if (order !== null) onReorder?.(order)
                        // The grip keeps focus on its habit after the tiles re-render in the new order.
                        window.requestAnimationFrame(() => {
                          list?.querySelector<HTMLButtonElement>(`li[data-habit-id="${id}"] .habit-history-grip`)?.focus()
                        })
                      }
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="habit-history-tile"
                  aria-label={habitPerformanceLabel(row)}
                  data-testid={`habit-history-row-${row.habit.id}`}
                  onClick={() => onOpenHabit(row.habit.id)}
                >
                  <HabitPerformanceDonut row={row} />
                  <span className="habit-history-tiletitle">
                    <span>{row.habit.name}</span>
                    {lifecycleLabel !== null ? (
                      <span className="habit-history-lifecycle">{lifecycleLabel}</span>
                    ) : null}
                  </span>
                  <span className="habit-history-tilecount tnum">
                    {row.trackedDays === 0
                      ? 'No tracked days yet'
                      : `${row.completedDays} of ${row.trackedDays} days`}
                  </span>
                  {row.partialDays > 0 || row.frozenDays > 0 || missedDays > 0 ? (
                    <span className="habit-history-tilestates">
                      {row.partialDays > 0 ? <span className="tnum">{row.partialDays} partial</span> : null}
                      {row.frozenDays > 0 ? (
                        <span className="habit-history-freezecount tnum">
                          <FreezeCrystal size={12} /> {row.frozenDays} frozen
                        </span>
                      ) : null}
                      {missedDays > 0 ? <span className="tnum">{missedDays} missed</span> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>}
      </section>
    </div>
  )
}
