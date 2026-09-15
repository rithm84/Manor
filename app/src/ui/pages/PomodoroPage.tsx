import { Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { completedFocusOn, earliestSessionMonth, monthOf, monthStats, shiftMonth } from '../../shared/pomodoro'
import type { PomodoroKind } from '../../shared/pomodoro'
import { Tooltip } from '../components/ui'
import { usePomodoroRuntime } from '../pomodoro/PomodoroRuntime'
import { useManorService } from '../services/ManorServices'
import { MonthStats } from './pomodoro/MonthStats'
import { SessionLog } from './pomodoro/SessionLog'
import { TimerPreferencesDialog } from './pomodoro/TimerPreferencesDialog'
import { TimerStage } from './pomodoro/TimerStage'
import { sessionDays } from './pomodoro/pomodoroModel'
import './pomodoro/pomodoro.css'

export function PomodoroPage(): ReactNode {
  const service = useManorService('pomodoro')
  const runtime = usePomodoroRuntime()
  const { state, active, clock, ended, next, busy, loading, error, run, acknowledge } = runtime
  const [month, setMonth] = useState<string | null>(null)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [pop, setPop] = useState<string | null>(null)

  const today = state?.today ?? null
  const shownMonth = month ?? (today === null ? null : monthOf(today))

  // A completed focus session nudges the month count once, then the count sits still.
  useEffect(() => {
    if (ended === null || ended.kind !== 'focus' || ended.status !== 'completed') return
    setPop(ended.id)
    const timer = window.setTimeout(() => setPop(null), 600)
    return (): void => window.clearTimeout(timer)
  }, [ended])

  const stats = useMemo(() => (state === null || shownMonth === null ? null : monthStats(state.sessions, shownMonth, state.today)), [state, shownMonth])
  const days = useMemo(() => (state === null || shownMonth === null ? [] : sessionDays(state.sessions, shownMonth)), [state, shownMonth])

  if (loading || state === null || today === null || shownMonth === null || stats === null) {
    return (
      <div className="pomo">
        <header className="pomo-header"><h1 className="page-title">Pomodoro</h1></header>
        {error !== null && state === null ? <div className="pomo-error" role="alert">{error}</div> : <div className="pomo-loading">Loading sessions…</div>}
      </div>
    )
  }

  const earliest = earliestSessionMonth(state.sessions, today)
  const currentMonth = monthOf(today)
  const start = (kind: PomodoroKind, label: string | null): void => { void run('Could not start the session', () => service.start({ kind, label })) }

  return (
    <div className="pomo">
      <header className="pomo-header">
        <h1 className="page-title">Pomodoro</h1>
        <Tooltip label="Timer preferences" side="bottom">
          <button type="button" className="pomo-iconbutton is-header" aria-label="Timer preferences" onClick={() => setPreferencesOpen(true)} data-testid="pomodoro-preferences">
            <Settings2 size={16} />
          </button>
        </Tooltip>
      </header>

      {error !== null ? <div className="pomo-error" role="alert">{error}</div> : null}

      <TimerStage
        active={active}
        clock={clock}
        ended={ended}
        next={next}
        settings={state.settings}
        completedToday={completedFocusOn(state.sessions, today)}
        busy={busy}
        onStart={start}
        onPause={() => { if (active !== null) void run('Could not pause', () => service.pause(active.id)) }}
        onResume={() => { if (active !== null) void run('Could not resume', () => service.resume(active.id)) }}
        onStop={() => { if (active !== null) void run('Could not stop the session', () => service.stop(active.id)) }}
        onRelabel={(label) => { if (active !== null) void run('Could not save the label', () => service.relabel(active.id, label)) }}
        onDismissEnded={acknowledge}
      />

      <MonthStats
        stats={stats}
        today={today}
        canMoveBack={shownMonth > earliest}
        canMoveForward={shownMonth < currentMonth}
        onMonthChange={(direction) => setMonth(shiftMonth(shownMonth, direction))}
        pop={shownMonth === currentMonth ? pop : null}
      />

      <SessionLog
        days={days}
        today={today}
        timezone={state.timezone}
        busy={busy}
        onRelabel={(id, label) => { void run('Could not save the label', () => service.relabel(id, label)) }}
        onRemove={(id) => { void run('Could not delete the session', () => service.remove(id)) }}
      />

      <TimerPreferencesDialog
        open={preferencesOpen}
        settings={state.settings}
        busy={busy}
        onClose={() => setPreferencesOpen(false)}
        onSave={(patch) => run('Could not save preferences', () => service.saveSettings(patch))}
      />
    </div>
  )
}
