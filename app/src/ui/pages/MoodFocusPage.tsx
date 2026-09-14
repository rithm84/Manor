import { useCommitVersion } from '../services/useCommitVersion'
import { useManorService } from '../services/ManorServices'
import { History, SlidersHorizontal } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { moodFocusPreviousDate } from '../../shared/moodFocus'
import type { Focus, Mood, MoodFocusEntry, MoodFocusHistoryMutation, MoodFocusState } from '../../shared/moodFocus'
import { DailyCapture } from './moodfocus/DailyCapture'
import { createMoodFocusSeed } from './moodfocus/moodFocusSeed'
import { dayLabel, fullDateLabel, monthKey } from './moodfocus/moodFocusModel'
import './moodfocus/moodfocus.css'

type MoodFocusView = 'daily' | 'history'

const MOOD_FOCUS_SEED = createMoodFocusSeed()
const HistoryPanel = lazy(async () => {
  const module = await import('./moodfocus/HistoryPanel')
  return { default: module.HistoryPanel }
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown mood and focus persistence error occurred'
}

export function MoodFocusPage(): ReactNode {
  const commitVersion = useCommitVersion()
  const moodFocusApi = useManorService('moodFocus')
  const [state, setState] = useState<MoodFocusState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [view, setView] = useState<MoodFocusView>('daily')
  const [selectedDate, setSelectedDate] = useState(MOOD_FOCUS_SEED.today)
  const [historyMonth, setHistoryMonth] = useState(monthKey(MOOD_FOCUS_SEED.today))

  useEffect(() => {
    let cancelled = false
    void moodFocusApi
      .load()
      .then((loaded) => {
        if (cancelled) {
          return
        }
        setState(loaded)
        if (state === null) {
          setSelectedDate(loaded.today)
          setHistoryMonth(monthKey(loaded.today))
        }
        setLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Mood and focus persistence load failed', { error })
        if (!cancelled) {
          setPersistError(errorMessage(error))
          setLoading(false)
        }
      })
    return (): void => {
      cancelled = true
    }
  }, [moodFocusApi, commitVersion])

  const persist = async (
    operation: string,
    mutation: () => Promise<MoodFocusState>
  ): Promise<boolean> => {
    setSaving(true)
    try {
      const next = await mutation()
      setState(next)
      setPersistError(null)
      return true
    } catch (error) {
      console.error('Mood and focus persistence operation failed', { operation, error })
      setPersistError(`${operation}: ${errorMessage(error)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  /** A rating tap shows at once; the committed entry replaces it, or the day returns to its previous entry on failure. */
  const rate = async (operation: string, change: Partial<Pick<MoodFocusEntry, 'mood' | 'focus'>>, mutation: () => Promise<MoodFocusState>): Promise<void> => {
    const before = state
    const stamp = new Date().toISOString()
    setState((current) => {
      if (current === null) return current
      const existing = current.entries.find((item) => item.date === selectedDate)
      const next: MoodFocusEntry = existing === undefined
        ? { date: selectedDate, mood: null, focus: null, note: null, noteSource: null, createdAt: stamp, updatedAt: stamp, ...change }
        : { ...existing, ...change, updatedAt: stamp }
      return { ...current, entries: [...current.entries.filter((item) => item.date !== selectedDate), next] }
    })
    if (!(await persist(operation, mutation))) setState(before)
  }

  const saveHistoryRatings = async (mutation: MoodFocusHistoryMutation): Promise<void> => {
    setSaving(true)
    try {
      const next = mutation.date === state?.today
        ? await moodFocusApi.setRatings(mutation)
        : await moodFocusApi.correctHistory(mutation)
      setState(next)
      setHistoryMonth(monthKey(mutation.date))
      setPersistError(null)
    } catch (error) {
      console.error('Mood and focus history save failed', { date: mutation.date, error })
      const message = `Could not save history: ${errorMessage(error)}`
      setPersistError(message)
      throw new Error(message, { cause: error })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mf">
        <header className="mf-header"><h1 className="page-title">Mood &amp; Focus</h1></header>
        <div className="mf-loading">Loading check-ins…</div>
      </div>
    )
  }

  if (state === null) {
    return (
      <div className="mf">
        <header className="mf-header"><h1 className="page-title">Mood &amp; Focus</h1></header>
        <div className="mf-error" role="alert">{persistError ?? 'Mood and focus data could not be loaded.'}</div>
      </div>
    )
  }

  const yesterday = moodFocusPreviousDate(state.today)
  const entry = state.entries.find((item) => item.date === selectedDate) ?? null

  return (
    <div className="mf">
      <header className="mf-header">
        <h1 className="page-title">Mood &amp; Focus</h1>
        <div className="mf-viewtabs" role="tablist" aria-label="Mood and focus view">
          <button type="button" role="tab" aria-selected={view === 'daily'} className={view === 'daily' ? 'is-selected' : ''} onClick={() => setView('daily')}>
            <SlidersHorizontal size={14} /> Daily
          </button>
          <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'is-selected' : ''} onClick={() => setView('history')}>
            <History size={14} /> History
          </button>
        </div>
      </header>

      {persistError !== null ? <div className="mf-error" role="alert">{persistError}</div> : null}

      {view === 'history' ? (
        <Suspense fallback={<div className="mf-loading">Loading history…</div>}>
          <HistoryPanel
            state={state}
            month={historyMonth}
            onMonthChange={setHistoryMonth}
            onSaveRatings={saveHistoryRatings}
          />
        </Suspense>
      ) : (
        <DailyCapture
          dayTitle={dayLabel(selectedDate, state.today)}
          dayDate={fullDateLabel(selectedDate)}
          previousDisabled={selectedDate === yesterday}
          nextDisabled={selectedDate === state.today}
          onPreviousDay={() => setSelectedDate(yesterday)}
          onNextDay={() => setSelectedDate(state.today)}
          entry={entry}
          saving={saving}
          onMoodChange={(mood: Mood) => void rate('Could not save mood', { mood }, () => moodFocusApi.setMood({ date: selectedDate, mood }))}
          onFocusChange={(focus: Focus) => void rate('Could not save focus', { focus }, () => moodFocusApi.setFocus({ date: selectedDate, focus }))}
        />
      )}
    </div>
  )
}
