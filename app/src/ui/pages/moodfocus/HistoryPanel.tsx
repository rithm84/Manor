import { ChevronLeft, ChevronRight, Mic, PencilLine, Plus, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { moodFocusPreviousDate } from '../../../shared/moodFocus'
import type { Focus, Mood, MoodFocusEntry, MoodFocusHistoryMutation, MoodFocusState } from '../../../shared/moodFocus'
import { Button, DatePicker, DetailDialog, EmptyState, Modal } from '../../components/ui'
import { dayLabel, earliestEntryMonth, fullDateLabel, monthKey, monthShift, monthSummary } from './moodFocusModel'
import { ScalePicker } from './ScalePicker'
import { focusOptions, moodOptions } from './scales'
import { focusTone, moodTone } from './scaleTones'
import type { ScaleTone } from './scaleTones'

export interface HistoryPanelProps {
  state: MoodFocusState
  month: string
  onMonthChange: (month: string) => void
  onSaveRatings: (mutation: MoodFocusHistoryMutation) => Promise<void>
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
  return (
    <button
      type="button"
      className={`mf-record-row is-editable${entry.date === today ? ' is-today' : ''}`}
      onClick={() => onEditDate(entry.date)}
      aria-label={`${dayLabel(entry.date, today)}. Mood ${entry.mood ?? 'not logged'}. Focus ${entry.focus ?? 'not logged'}. Edit entry.`}
      data-testid={`history-record-${entry.date}`}
    >
      <span className="mf-record-date" aria-hidden="true">
        <span>{weekdayLabel(entry.date)}</span>
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
          {entry.note !== null && entry.noteSource === 'codex' ? (
            <span className="mf-record-source"><Mic size={11} /> Codex debrief</span>
          ) : null}
          {entry.note !== null && entry.noteSource === 'manual' ? (
            <span className="mf-record-source"><PencilLine size={11} /> Manual</span>
          ) : null}
        </span>
      </span>
      <span className="mf-record-edit" aria-hidden="true">
        <PencilLine size={13} /> Edit
      </span>
    </button>
  )
}

export function HistoryPanel({ state, month, onMonthChange, onSaveRatings }: HistoryPanelProps): ReactNode {
  const summary = monthSummary(state.entries, month)
  const [editorDate, setEditorDate] = useState<string | null>(null)
  const [editorBaseline, setEditorBaseline] = useState<MoodFocusEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [range, setRange] = useState<'month' | 'quarter'>('month')
  const rangeStart = range === 'month' ? month : monthShift(month, -2)
  const plotEntries = state.entries.filter((entry) => entry.date >= `${rangeStart}-01` && entry.date < `${monthShift(month, 1)}-01`)
  const rangeDays = Math.round((new Date(`${monthShift(month, 1)}-01T12:00:00Z`).getTime() - new Date(`${rangeStart}-01T12:00:00Z`).getTime()) / 86400000)
  const moodDays = plotEntries.filter((entry) => entry.mood !== null).length
  const focusDays = plotEntries.filter((entry) => entry.focus !== null).length
  const currentMonth = monthKey(state.today)
  const canMoveForward = month < currentMonth
  const canMoveBack = month > earliestEntryMonth(state)

  return (
    <div className="mf-history">
      <section className="mf-history-head">
        <h2>History</h2>
        <div className="mf-history-actions">
          <Button variant="subtle" icon={<Plus size={15} />} onClick={() => { const date = moodFocusPreviousDate(state.today); setAdding(true); setEditorBaseline(state.entries.find((entry) => entry.date === date) ?? null); setEditorDate(date) }} testId="history-add-day">Add day</Button>
          <div className="mf-month-nav" role="group" aria-label="History month">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canMoveBack}
            onClick={() => onMonthChange(monthShift(month, -1))}
          >
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
        </div>
      </section>

      <div className="mf-range-toolbar">
        <div className="mf-viewtabs" aria-label="History range">
          <button type="button" data-testid="history-range-month" aria-pressed={range === 'month'} className={range === 'month' ? 'is-selected' : ''} onClick={() => setRange('month')}>Month</button>
          <button type="button" data-testid="history-range-quarter" aria-pressed={range === 'quarter'} className={range === 'quarter' ? 'is-selected' : ''} onClick={() => setRange('quarter')}>3 months</button>
        </div>
        <span>{rangeStart === month ? summary.label : `${monthSummary([], rangeStart).label} – ${summary.label}`}</span>
      </div>
      <section className="mf-summary-line" aria-label="Recording coverage">
        <div><span className="mf-summary-value tnum">{moodDays} / {rangeDays}</span><span>days with mood</span></div>
        <div><span className="mf-summary-value tnum">{focusDays} / {rangeDays}</span><span>days with focus</span></div>
        <div><span className="mf-summary-value tnum">{plotEntries.filter((entry) => entry.focus === 'Resting').length}</span><span>rest days</span></div>
      </section>
      <section className="mf-trend" aria-label="Mood and focus over time">
        <SignalPlot signal="mood" entries={plotEntries} start={rangeStart} days={rangeDays} onOpen={(entry) => { setAdding(false); setEditorBaseline(entry); setEditorDate(entry.date) }} />
        <SignalPlot signal="focus" entries={plotEntries} start={rangeStart} days={rangeDays} onOpen={(entry) => { setAdding(false); setEditorBaseline(entry); setEditorDate(entry.date) }} />
        <p className="mf-chart-note">Each dot is a recorded day. Gaps are days without a rating.</p>
      </section>

      <section className="mf-records" aria-labelledby="mf-records-title">
        <div className="mf-section-head">
          <h3 id="mf-records-title">Daily record</h3>
        </div>
        {plotEntries.length === 0 ? (
          <EmptyState icon={<TrendingUp size={20} />} title="No check-ins" message={`No entries in ${summary.label}.`} />
        ) : (
          <div className="mf-record-stack">
            {[...plotEntries].reverse().map((entry) => (
              <RecordRow key={entry.date} entry={entry} today={state.today} onEditDate={(date) => { setAdding(false); setEditorBaseline(entry); setEditorDate(date) }} />
            ))}
          </div>
        )}
      </section>
      <HistoryEditor
        open={editorDate !== null}
        adding={adding}
        date={editorDate}
        baseline={editorBaseline}
        today={state.today}
        onDateChange={(date) => { setEditorBaseline(date === null ? null : state.entries.find((entry) => entry.date === date) ?? null); setEditorDate(date) }}
        onClose={() => setEditorDate(null)}
        onSave={async (mutation) => { await onSaveRatings(mutation); setEditorDate(null) }}
      />
    </div>
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

function SignalPlot({ signal, entries, start, days, onOpen }: {
  signal: 'mood' | 'focus'
  entries: readonly MoodFocusEntry[]
  start: string
  days: number
  onOpen: (entry: MoodFocusEntry) => void
}): ReactNode {
  const levels = signal === 'mood' ? ['Great', 'Good', 'Neutral', 'Bad', 'Awful'] : ['Locked In', 'High', 'Medium', 'Low', 'Locked Out', 'Resting']
  const firstDay = new Date(`${start}-01T12:00:00Z`).getTime()
  return <div className={`mf-signal-plot is-${signal}`}>
    <h3>{signal === 'mood' ? 'Mood' : 'Focus'}</h3>
    {levels.map((level) => <div className={`mf-plot-band${level === 'Resting' ? ' is-resting' : ''}`} key={level}>
      <span className="mf-plot-label">{level}</span>
      <div className="mf-plot-track">
        {entries.filter((entry) => entry[signal] === level).map((entry) => {
          const offset = Math.round((new Date(`${entry.date}T12:00:00Z`).getTime() - firstDay) / 86400000)
          return <button type="button" key={entry.date} className="mf-plot-dot" style={{ left: `${((offset + 0.5) / days) * 100}%` }} aria-label={`${fullDateLabel(entry.date)}: ${level}`} title={`${fullDateLabel(entry.date)}: ${level}`} data-testid={`plot-${signal}-${entry.date}`} onClick={() => onOpen(entry)} />
        })}
      </div>
    </div>)}
    <div className="mf-plot-axis"><span>{fullDateLabel(`${start}-01`)}</span><span>{days} days</span></div>
  </div>
}
