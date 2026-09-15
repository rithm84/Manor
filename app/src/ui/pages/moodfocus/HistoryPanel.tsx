import { ChevronLeft, ChevronRight, Mic, PencilLine, Plus, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { moodFocusPreviousDate } from '../../../shared/moodFocus'
import type { Focus, Mood, MoodFocusEntry, MoodFocusHistoryMutation, MoodFocusState } from '../../../shared/moodFocus'
import { Button, DatePicker, DetailDialog, EmptyState, Modal } from '../../components/ui'
import {
  dayLabel,
  daysInMonth,
  earliestEntryMonth,
  entriesForMonth,
  focusAverageLabel,
  focusDistribution,
  fullDateLabel,
  monthGrid,
  monthKey,
  monthShift,
  monthSummary,
  monthTrend,
  moodAverageLabel,
  moodDistribution
} from './moodFocusModel'
import type { MoodFocusTrendRange } from './moodFocusModel'
import { ScalePicker } from './ScalePicker'
import { focusOptions, moodOptions } from './scales'
import { focusTone, focusToneAtAverage, moodTone, moodToneAtAverage } from './scaleTones'
import type { ScaleTone } from './scaleTones'

export interface HistoryPanelProps {
  state: MoodFocusState
  month: string
  onMonthChange: (month: string) => void
  onSaveRatings: (mutation: MoodFocusHistoryMutation) => Promise<void>
}

type ToneStyle = CSSProperties & {
  '--signal-tone': string
  '--signal-tint': string
}

function toneStyle(tone: ScaleTone | null): ToneStyle | undefined {
  if (tone === null) {
    return undefined
  }
  return { '--signal-tone': tone.strong, '--signal-tint': tone.tint }
}

const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00.000Z`))
}

interface EditorTarget {
  date: string
  adding: boolean
}

export function HistoryPanel({ state, month, onMonthChange, onSaveRatings }: HistoryPanelProps): ReactNode {
  const summary = monthSummary(state.entries, month)
  const monthEntries = entriesForMonth(state.entries, month)
  const [target, setTarget] = useState<EditorTarget | null>(null)
  const [editorBaseline, setEditorBaseline] = useState<MoodFocusEntry | null>(null)
  const [range, setRange] = useState<MoodFocusTrendRange>(6)
  const trend = monthTrend(state, month, range)
  const grid = monthGrid(state.entries, month, state.today)
  const currentMonth = monthKey(state.today)
  const canMoveForward = month < currentMonth
  const canMoveBack = month > earliestEntryMonth(state)
  const dayCount = month === currentMonth ? Number(state.today.slice(8)) : daysInMonth(month)
  const moodWord = moodAverageLabel(summary.moodAverage)
  const focusWord = focusAverageLabel(summary.focusAverage)
  const openEntry = (entry: MoodFocusEntry): void => {
    setEditorBaseline(entry)
    setTarget({ date: entry.date, adding: false })
  }
  const openDate = (date: string, adding: boolean): void => {
    setEditorBaseline(state.entries.find((entry) => entry.date === date) ?? null)
    setTarget({ date, adding })
  }

  return (
    <div className="mf-history">
      <section className="mf-history-topline">
        <div>
          <h2>Looking back</h2>
          <p>Mood and focus, one day at a time.</p>
        </div>
        <div className="mf-history-actions">
          <Button variant="subtle" icon={<Plus size={15} />} onClick={() => openDate(moodFocusPreviousDate(state.today), true)} testId="history-add-day">Add day</Button>
          <div className="mf-month-nav" role="group" aria-label="History month">
            <button type="button" aria-label="Previous month" disabled={!canMoveBack} onClick={() => onMonthChange(monthShift(month, -1))}>
              <ChevronLeft size={16} />
            </button>
            <span aria-live="polite">{summary.label}</span>
            <button type="button" aria-label="Next month" disabled={!canMoveForward} onClick={() => onMonthChange(monthShift(month, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="mf-history-summary" aria-label={`${summary.label} summary`}>
        <div className="is-toned" style={toneStyle(summary.moodAverage === null ? null : moodToneAtAverage(summary.moodAverage))}>
          <span className="mf-history-summaryvalue">{moodWord ?? 'No ratings'}</span>
          <span className="mf-history-summarylabel">
            Average mood{summary.moodAverage !== null ? <span className="tnum">{summary.moodAverage.toFixed(1)}</span> : null}
          </span>
        </div>
        <div className="is-toned" style={toneStyle(summary.focusAverage === null ? null : focusToneAtAverage(summary.focusAverage))}>
          <span className="mf-history-summaryvalue">{focusWord ?? 'No ratings'}</span>
          <span className="mf-history-summarylabel">
            Average focus{summary.focusAverage !== null ? <span className="tnum">{summary.focusAverage.toFixed(1)}</span> : null}
          </span>
        </div>
        <div>
          <span className="mf-history-summaryvalue tnum">{summary.loggedDays}<small> of {dayCount}</small></span>
          <span className="mf-history-summarylabel">Days logged</span>
        </div>
        <div>
          <span className="mf-history-summaryvalue tnum">{summary.restDays}</span>
          <span className="mf-history-summarylabel">Rest days</span>
        </div>
      </section>

      <section className="mf-history-trend" aria-labelledby="mf-trend-title">
        <div className="mf-history-sectionhead">
          <div>
            <h3 id="mf-trend-title">{range}-month trend</h3>
            <p>Monthly averages, with rest days left out of focus.</p>
          </div>
          <div className="mf-history-trendcontrols">
            <div className="mf-history-legend" aria-hidden="true">
              <span><span className="mf-history-legenddot is-mood" /> Mood</span>
              <span><span className="mf-history-legenddot is-focus" /> Focus</span>
            </div>
            <div className="mf-history-range" role="group" aria-label="Trend range">
              {([3, 6, 12] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={range === option ? 'is-selected' : ''}
                  aria-label={`Show ${option} months`}
                  aria-pressed={range === option}
                  onClick={() => setRange(option)}
                >
                  {option}m
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mf-history-chart" role="img" aria-label={`${range}-month mood and focus averages ending ${summary.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart accessibilityLayer data={trend} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--hairline)" strokeDasharray="2 4" />
              <XAxis axisLine={false} dataKey="shortLabel" tick={{ fill: 'var(--ink-muted)', fontSize: 12 }} tickLine={false} />
              <YAxis
                axisLine={false}
                domain={[1, 5]}
                tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
                tickLine={false}
                ticks={[1, 2, 3, 4, 5]}
                width={28}
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
                formatter={(value, name) => [
                  `${String(value)} · ${name === 'Mood' ? moodAverageLabel(Number(value)) ?? '' : focusAverageLabel(Number(value)) ?? ''}`,
                  String(name)
                ]}
                isAnimationActive={false}
                labelStyle={{ color: 'var(--ink)', fontWeight: 600, marginBottom: 4 }}
              />
              <Line
                activeDot={{ fill: 'var(--surface-card)', r: 4, stroke: 'var(--mf-mood)', strokeWidth: 2 }}
                connectNulls
                dataKey="mood"
                dot={{ fill: 'var(--surface-card)', r: 2.5, stroke: 'var(--mf-mood)', strokeWidth: 1.5 }}
                isAnimationActive={false}
                name="Mood"
                stroke="var(--mf-mood)"
                strokeWidth={2}
                type="monotone"
              />
              <Line
                activeDot={{ fill: 'var(--surface-card)', r: 4, stroke: 'var(--mf-focus)', strokeWidth: 2 }}
                connectNulls
                dataKey="focus"
                dot={{ fill: 'var(--surface-card)', r: 2.5, stroke: 'var(--mf-focus)', strokeWidth: 1.5 }}
                isAnimationActive={false}
                name="Focus"
                stroke="var(--mf-focus)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mf-history-month" aria-labelledby="mf-month-title">
        <div className="mf-history-sectionhead">
          <div>
            <h3 id="mf-month-title">{summary.label}</h3>
            <p>Each day is colored by mood and marked by focus.</p>
          </div>
        </div>
        <div className="mf-history-monthbody">
          <div className="mf-month-grid" role="grid" aria-label={`${summary.label} check-ins`}>
            <div role="row" className="mf-month-weekdays">
              {WEEKDAY_HEADERS.map((label, index) => (
                <span key={index} role="columnheader" aria-hidden="true">{label}</span>
              ))}
            </div>
            <div role="row" className="mf-month-days">
              {Array.from({ length: grid.leadBlanks }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
              {grid.cells.map((cell) => {
                const mood = cell.entry?.mood ?? null
                const focus = cell.entry?.focus ?? null
                const description = cell.entry === null
                  ? 'No check-in.'
                  : `Mood ${mood ?? 'not logged'}. Focus ${focus ?? 'not logged'}.`
                return (
                  <button
                    key={cell.date}
                    type="button"
                    role="gridcell"
                    className={`mf-month-day${mood !== null ? ' has-mood' : ''}${focus === 'Resting' ? ' is-resting' : ''}${cell.today ? ' is-today' : ''}${cell.entry === null ? ' is-empty' : ''}`}
                    style={{
                      ...(mood === null ? {} : { '--mood-tone': moodTone(mood).strong, '--mood-tint': moodTone(mood).tint }),
                      ...(focus === null ? {} : { '--focus-tone': focusTone(focus).strong })
                    } as CSSProperties}
                    disabled={cell.future}
                    aria-label={`${fullDateLabel(cell.date)}. ${description}`}
                    data-testid={`history-day-${cell.date}`}
                    onClick={() => (cell.entry === null ? openDate(cell.date, false) : openEntry(cell.entry))}
                  >
                    <span className="mf-month-daynum tnum">{cell.day}</span>
                    {focus !== null ? <span className="mf-month-focusdot" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mf-history-distributions">
            <Distribution
              title="Mood"
              rows={moodDistribution(monthEntries).map((row) => ({ level: row.level, count: row.count, share: row.share, tone: moodTone(row.level) }))}
              kind="mood"
            />
            <Distribution
              title="Focus"
              rows={focusDistribution(monthEntries).map((row) => ({ level: row.level, count: row.count, share: row.share, tone: focusTone(row.level) }))}
              kind="focus"
            />
          </div>
        </div>
      </section>

      <section className="mf-records" aria-labelledby="mf-records-title">
        <div className="mf-history-sectionhead">
          <div>
            <h3 id="mf-records-title">Daily record</h3>
            <p>Newest first.</p>
          </div>
        </div>
        {monthEntries.length === 0 ? (
          <EmptyState icon={<TrendingUp size={20} />} title="No check-ins" message={`No entries in ${summary.label}.`} />
        ) : (
          <div className="mf-record-stack">
            {[...monthEntries].reverse().map((entry) => (
              <RecordRow key={entry.date} entry={entry} today={state.today} onOpen={openEntry} />
            ))}
          </div>
        )}
      </section>

      <HistoryEditor
        open={target !== null}
        adding={target?.adding ?? false}
        date={target?.date ?? null}
        baseline={editorBaseline}
        today={state.today}
        onDateChange={(date) => {
          setEditorBaseline(date === null ? null : state.entries.find((entry) => entry.date === date) ?? null)
          setTarget(date === null ? null : { date, adding: true })
        }}
        onClose={() => setTarget(null)}
        onSave={async (mutation) => { await onSaveRatings(mutation); setTarget(null) }}
      />
    </div>
  )
}

function Distribution({ title, rows, kind }: {
  title: string
  rows: readonly { level: string; count: number; share: number; tone: ScaleTone }[]
  kind: 'mood' | 'focus'
}): ReactNode {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  return (
    <div className={`mf-distribution is-${kind}`}>
      <h4>{title}</h4>
      <ol aria-label={`${title} distribution`}>
        {rows.map((row) => (
          <li key={row.level} style={toneStyle(row.tone)} className={row.level === 'Resting' ? 'is-resting' : ''} aria-label={`${row.level}: ${row.count} ${row.count === 1 ? 'day' : 'days'}`}>
            <span className="mf-distribution-swatch" aria-hidden="true" />
            <span className="mf-distribution-level">{row.level}</span>
            <span className="mf-distribution-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(row.share * 100)}%` }} />
            </span>
            <span className="mf-distribution-count tnum" aria-hidden="true">{total === 0 ? '' : row.count}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Signal({ kind, value }: { kind: 'mood' | 'focus'; value: Mood | Focus | null }): ReactNode {
  const tone = value === null ? null : kind === 'mood' ? moodTone(value as Mood) : focusTone(value as Focus)
  return (
    <span className={`mf-record-signal is-${kind}${value === null ? ' is-missing' : ''}${value === 'Resting' ? ' is-resting' : ''}`} style={toneStyle(tone)}>
      <span aria-hidden="true" />
      {value ?? 'Not logged'}
    </span>
  )
}

function RecordRow({ entry, today, onOpen }: {
  entry: MoodFocusEntry
  today: string
  onOpen: (entry: MoodFocusEntry) => void
}): ReactNode {
  return (
    <button
      type="button"
      className={`mf-record-row${entry.date === today ? ' is-today' : ''}`}
      onClick={() => onOpen(entry)}
      aria-label={`${dayLabel(entry.date, today)}. Mood ${entry.mood ?? 'not logged'}. Focus ${entry.focus ?? 'not logged'}. Edit entry.`}
      data-testid={`history-record-${entry.date}`}
    >
      <span className="mf-record-date" aria-hidden="true">
        <span className="tnum">{Number(entry.date.slice(8))}</span>
        <span>{weekdayLabel(entry.date)}</span>
      </span>
      <Signal kind="mood" value={entry.mood} />
      <Signal kind="focus" value={entry.focus} />
      {entry.note === null ? (
        <span className="mf-record-note is-empty" />
      ) : (
        <span className="mf-record-note">
          {entry.noteSource === 'codex' ? <Mic size={12} aria-hidden="true" /> : <PencilLine size={12} aria-hidden="true" />}
          <span>{entry.note}</span>
          <span className="mf-record-source">{entry.noteSource === 'codex' ? 'Codex debrief' : 'Manual'}</span>
        </span>
      )}
      <ChevronRight className="mf-record-chevron" size={14} aria-hidden="true" />
    </button>
  )
}

function HistoryEditor({ open, adding, date, baseline, today, onDateChange, onClose, onSave }: {
  open: boolean
  adding: boolean
  date: string | null
  baseline: MoodFocusEntry | null
  today: string
  onDateChange: (date: string | null) => void
  onClose: () => void
  onSave: (mutation: MoodFocusHistoryMutation) => Promise<void>
}): ReactNode {
  const entry = baseline
  const [mood, setMood] = useState<Mood | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  useEffect(() => {
    setMood(entry?.mood ?? null)
    setFocus(entry?.focus ?? null)
    setError(null)
  }, [date, entry?.mood, entry?.focus])
  const dirty = mood !== (entry?.mood ?? null) || focus !== (entry?.focus ?? null)
  const requestClose = (): void => {
    if (saving) return
    if (dirty) { setConfirmDiscard(true); return }
    onClose()
  }
  const save = async (): Promise<void> => {
    if (date === null || (mood === null && focus === null)) { setError('Choose a mood or focus rating.'); return }
    setSaving(true); setError(null)
    try { await onSave({ date, mood, focus, expectedUpdatedAt: entry?.updatedAt ?? null }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The ratings could not be saved.') }
    finally { setSaving(false) }
  }
  return <><DetailDialog open={open} onClose={requestClose} title={date === null ? 'Add day' : fullDateLabel(date)} width={720} ariaLabel="Edit mood and focus history">
    <div className="mf-history-editor">
      {adding ? <div className="mf-history-date"><span>Date</span><DatePicker value={date} onChange={onDateChange} ariaLabel="History date" min={null} max={moodFocusPreviousDate(today)} required today={today} /></div> : null}
      <ScalePicker id="history-mood" prompt="Mood" kind="mood" options={moodOptions} value={mood} onChange={setMood} />
      <ScalePicker id="history-focus" prompt="Focus" kind="focus" options={focusOptions} value={focus} onChange={setFocus} />
      {entry?.note !== null && entry?.note !== undefined ? <section className="mf-history-synthesis"><h3>Daily synthesis</h3><p>{entry.note}</p><span className="mf-record-source">{entry.noteSource === 'codex' ? 'Codex debrief' : 'Manual'}</span></section> : null}
      {error !== null ? <p className="mf-history-editor-error" role="alert">{error}</p> : null}
      <footer className="mf-history-editor-footer"><Button variant="ghost" disabled={saving} onClick={requestClose}>Cancel</Button><Button variant="primary" disabled={saving || date === null || (mood === null && focus === null)} onClick={() => void save()} testId="history-save-ratings">{saving ? 'Saving…' : entry === null ? 'Add record' : 'Save changes'}</Button></footer>
    </div>
  </DetailDialog><Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} width={400} ariaLabel="Discard history changes"><div className="mf-history-discard"><h2>Discard changes?</h2><p>Your rating changes have not been saved.</p><footer><Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Keep editing</Button><Button variant="primary" onClick={() => { setConfirmDiscard(false); onClose() }}>Discard</Button></footer></div></Modal></>
}
