import { ChevronLeft, ChevronRight, LockKeyhole, Mic, PencilLine, TrendingUp } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import type { MoodFocusEntry, MoodFocusState } from '../../../../shared/moodFocus'
import { EmptyState } from '../../components/ui'
import {
  canEditEntry,
  dayLabel,
  entriesForMonth,
  monthKey,
  monthShift,
  monthSummary,
  sixMonthTrend
} from './moodFocusModel'
import { focusTone, focusToneAtAverage, moodTone, moodToneAtAverage } from './scaleTones'
import type { ScaleTone } from './scaleTones'

export interface HistoryPanelProps {
  state: MoodFocusState
  month: string
  onMonthChange: (month: string) => void
  onEditDate: (date: string) => void
}

function averageLabel(value: number | null): string {
  return value === null ? 'None' : value.toFixed(1)
}

function signalClass(signal: 'mood' | 'focus', missing: boolean): string {
  return `mf-record-signal is-${signal}${missing ? ' is-missing' : ''}`
}

type SignalStyle = CSSProperties & {
  '--signal-tone': string
  '--signal-tint': string
}

function signalStyle(tone: ScaleTone | null): SignalStyle | undefined {
  if (tone === null) {
    return undefined
  }
  return {
    '--signal-tone': tone.strong,
    '--signal-tint': tone.tint
  }
}

interface TrendDotProps {
  signal: 'mood' | 'focus'
  active?: boolean
  cx?: number
  cy?: number
  value?: number | null
}

function TrendDot({ signal, active = false, cx, cy, value }: TrendDotProps): ReactNode {
  if (cx === undefined || cy === undefined || value === undefined || value === null) {
    return null
  }
  const tone = signal === 'mood' ? moodToneAtAverage(value) : focusToneAtAverage(value)
  return (
    <circle
      cx={cx}
      cy={cy}
      r={active ? 4.5 : 3.5}
      fill={tone.tint}
      stroke={tone.strong}
      strokeWidth={active ? 2.25 : 1.75}
    />
  )
}

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short'
  }).format(new Date(`${date}T12:00:00.000Z`))
}

function RecordRow({
  entry,
  today,
  onEditDate
}: {
  entry: MoodFocusEntry
  today: string
  onEditDate: (date: string) => void
}): ReactNode {
  const editable = canEditEntry(entry.date, today)
  return (
    <button
      type="button"
      className={`mf-record-row${editable ? ' is-editable' : ''}`}
      disabled={!editable}
      onClick={() => onEditDate(entry.date)}
      aria-label={`${dayLabel(entry.date, today)}. Mood ${entry.mood ?? 'not logged'}. Focus ${entry.focus ?? 'not logged'}${editable ? '. Edit entry.' : ''}`}
    >
      <span className="mf-record-date" aria-hidden="true">
        <span>{editable ? dayLabel(entry.date, today) : weekdayLabel(entry.date)}</span>
        <span className="tnum">{entry.date.slice(8)}</span>
      </span>
      <span className="mf-record-content">
        <span className="mf-record-signals">
          <span
            className={signalClass('mood', entry.mood === null)}
            style={signalStyle(entry.mood === null ? null : moodTone(entry.mood))}
          >
            <span className="mf-record-signal-name">Mood</span>
            <span className="mf-record-signal-value">
              <span aria-hidden="true" />
              {entry.mood ?? 'Not logged'}
            </span>
          </span>
          <span
            className={signalClass('focus', entry.focus === null)}
            style={signalStyle(entry.focus === null ? null : focusTone(entry.focus))}
          >
            <span className="mf-record-signal-name">Focus</span>
            <span className="mf-record-signal-value">
              <span aria-hidden="true" />
              {entry.focus ?? 'Not logged'}
            </span>
          </span>
        </span>
        <span className={`mf-record-note${entry.note === null ? ' is-empty' : ''}`}>
          <span>{entry.note ?? 'No debrief'}</span>
          {entry.note !== null && entry.noteSource === 'alfred' ? (
            <span className="mf-record-source"><Mic size={11} /> Alfred debrief</span>
          ) : null}
          {entry.note !== null && entry.noteSource === 'manual' ? (
            <span className="mf-record-source"><PencilLine size={11} /> Manual</span>
          ) : null}
        </span>
      </span>
      <span className="mf-record-edit" aria-hidden="true">
        {editable ? <><PencilLine size={13} /> Edit</> : null}
      </span>
    </button>
  )
}

function RecordGroup({
  label,
  readOnly,
  entries,
  today,
  onEditDate
}: {
  label: string
  readOnly: boolean
  entries: readonly MoodFocusEntry[]
  today: string
  onEditDate: (date: string) => void
}): ReactNode {
  if (entries.length === 0) {
    return null
  }
  return (
    <section className="mf-record-group" aria-label={label}>
      <header className="mf-record-group-head">
        <h4>{label}</h4>
        <span>{readOnly ? <><LockKeyhole size={11} /> Read only</> : 'Editable'}</span>
      </header>
      <div className="mf-record-stack">
        {entries.map((entry) => (
          <RecordRow key={entry.date} entry={entry} today={today} onEditDate={onEditDate} />
        ))}
      </div>
    </section>
  )
}

export function HistoryPanel({ state, month, onMonthChange, onEditDate }: HistoryPanelProps): ReactNode {
  const summary = monthSummary(state.entries, month)
  const entries = [...entriesForMonth(state.entries, month)].reverse()
  const trend = sixMonthTrend(state, month)
  const currentMonth = monthKey(state.today)
  const canMoveForward = month < currentMonth
  const editableEntries = entries.filter((entry) => canEditEntry(entry.date, state.today))
  const archivedEntries = entries.filter((entry) => !canEditEntry(entry.date, state.today))
  const monthName = summary.label.replace(/ \d{4}$/, '')

  return (
    <div className="mf-history">
      <section className="mf-history-head">
        <h2>History</h2>
        <div className="mf-month-nav" role="group" aria-label="History month">
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(monthShift(month, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span aria-live="polite">{summary.label}</span>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canMoveForward}
            onClick={() => onMonthChange(monthShift(month, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </section>

      <section className="mf-summary-line" aria-label={`${summary.label} summary`}>
        <div className="mf-summary-primary">
          <span className="mf-summary-value tnum">{summary.loggedDays}</span>
          <span>days logged</span>
        </div>
        <div>
          <span className="mf-summary-value tnum">{averageLabel(summary.moodAverage)}</span>
          <span>average mood</span>
        </div>
        <div>
          <span className="mf-summary-value tnum">{averageLabel(summary.focusAverage)}</span>
          <span>average focus</span>
        </div>
        <div>
          <span className="mf-summary-value tnum">{summary.restDays}</span>
          <span>rest days</span>
        </div>
      </section>

      <section className="mf-trend" aria-labelledby="mf-trend-title">
        <div className="mf-section-head">
          <div>
            <h3 id="mf-trend-title">Six-month averages</h3>
          </div>
          <div className="mf-trend-key" aria-hidden="true">
            <span className="is-mood"><span /> Mood</span>
            <span className="is-focus"><span /> Focus</span>
          </div>
        </div>
        <div className="mf-trend-chart" role="img" aria-label={`Mood and focus averages for the six months ending ${summary.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart accessibilityLayer data={trend} margin={{ top: 10, right: 14, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="2 5" />
              <XAxis axisLine={false} dataKey="shortLabel" tick={{ fill: 'var(--ink-muted)', fontSize: 11 }} tickLine={false} />
              <YAxis axisLine={false} domain={[1, 5]} tick={{ fill: 'var(--ink-muted)', fontSize: 10 }} tickLine={false} ticks={[1, 2, 3, 4, 5]} width={32} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--hairline)', borderRadius: 8, boxShadow: 'var(--shadow-overlay)', color: 'var(--ink-body)', fontSize: 12 }}
                cursor={{ stroke: 'var(--surface-strong)', strokeWidth: 1 }}
                formatter={(value, name) => [Number(value).toFixed(1), name]}
                isAnimationActive={false}
                labelStyle={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 4 }}
              />
              <Line activeDot={<TrendDot signal="mood" active />} connectNulls={false} dataKey="mood" dot={<TrendDot signal="mood" />} isAnimationActive={false} name="Mood" stroke="var(--mf-mood)" strokeWidth={2} type="monotone" />
              <Line activeDot={<TrendDot signal="focus" active />} connectNulls={false} dataKey="focus" dot={<TrendDot signal="focus" />} isAnimationActive={false} name="Focus" stroke="var(--mf-focus)" strokeWidth={2} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mf-records" aria-labelledby="mf-records-title">
        <div className="mf-section-head">
          <h3 id="mf-records-title">Daily record</h3>
        </div>
        {entries.length === 0 ? (
          <EmptyState icon={<TrendingUp size={20} />} title="No check-ins" message={`No entries in ${summary.label}.`} />
        ) : (
          <div className="mf-record-groups">
            <RecordGroup
              label="Today and yesterday"
              readOnly={false}
              entries={editableEntries}
              today={state.today}
              onEditDate={onEditDate}
            />
            <RecordGroup
              label={month === currentMonth ? `Earlier in ${monthName}` : monthName}
              readOnly={true}
              entries={archivedEntries}
              today={state.today}
              onEditDate={onEditDate}
            />
          </div>
        )}
      </section>
    </div>
  )
}
