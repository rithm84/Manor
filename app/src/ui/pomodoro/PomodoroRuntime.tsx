import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { activeSession, isFinished, nextKind, sessionClock } from '../../shared/pomodoro'
import type { PomodoroClock, PomodoroKind, PomodoroSession, PomodoroState } from '../../shared/pomodoro'
import { useOptionalManorService } from '../services/ManorServices'
import { useCommitVersion } from '../services/useCommitVersion'
import { playSessionChime } from '../sound/sounds'

export interface PomodoroRuntime {
  state: PomodoroState | null
  loading: boolean
  error: string | null
  /** The instant the clock last ticked; sessions derive their countdown from it. */
  now: number
  active: PomodoroSession | null
  clock: PomodoroClock | null
  /**
   * The session whose time just ran out, held until the page acknowledges it, so the stage can show the
   * finished ring and offer what comes next. Cleared when another session starts.
   */
  ended: PomodoroSession | null
  /** What the ended session leads to; focus when nothing ended. */
  next: PomodoroKind
  acknowledge: () => void
  /** Runs a write, replaces the state with what it committed, and records a failure for the page to show. */
  run: (label: string, work: () => Promise<PomodoroState>) => Promise<boolean>
  /** Whether a write is in flight. */
  busy: boolean
}

const RuntimeContext = createContext<PomodoroRuntime | null>(null)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown Pomodoro error occurred'
}

/** Milliseconds until the next whole second, so ticks land on the boundary the clock digits change on. */
function untilNextSecond(now: number): number {
  return 1000 - (now % 1000)
}

/**
 * Keeps the Pomodoro clock for the whole app: loads sessions, ticks while one runs, records a session's
 * completion the moment its time runs out, and plays the chime, whichever page is open. Without the
 * service (layout tests) it renders its children and nothing else.
 */
export function PomodoroRuntimeProvider({ children }: { children: ReactNode }): ReactNode {
  const service = useOptionalManorService('pomodoro')
  const commitVersion = useCommitVersion()
  const [state, setState] = useState<PomodoroState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [ended, setEnded] = useState<PomodoroSession | null>(null)
  const [busy, setBusy] = useState(false)
  const completing = useRef<string | null>(null)
  const autoStarted = useRef<string | null>(null)

  useEffect(() => {
    if (service === undefined) return
    let cancelled = false
    void service.load().then((loaded) => {
      if (cancelled) return
      setState(loaded)
      setLoading(false)
      setError(null)
    }).catch((failure: unknown) => {
      console.error('Pomodoro load failed', { error: failure })
      if (cancelled) return
      setError(errorMessage(failure))
      setLoading(false)
    })
    return (): void => { cancelled = true }
  }, [service, commitVersion])

  const active = useMemo(() => (state === null ? null : activeSession(state.sessions)), [state])
  const running = active !== null && active.status === 'running'

  useEffect(() => {
    setNow(Date.now())
    if (!running) return
    let timer = 0
    const tick = (): void => {
      const current = Date.now()
      setNow(current)
      timer = window.setTimeout(tick, untilNextSecond(current))
    }
    timer = window.setTimeout(tick, untilNextSecond(Date.now()))
    return (): void => window.clearTimeout(timer)
  }, [running, active?.id])

  const clock = useMemo(() => (active === null ? null : sessionClock(active, now)), [active, now])

  const run = useCallback(async (label: string, work: () => Promise<PomodoroState>): Promise<boolean> => {
    setBusy(true)
    try {
      const next = await work()
      setState(next)
      setError(null)
      return true
    } catch (failure) {
      console.error('Pomodoro write failed', { label, error: failure })
      setError(`${label}: ${errorMessage(failure)}`)
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  // The plan ran out: record the completion on the server, which holds the clock, then chime.
  const activeId = active?.id ?? null
  const activeKind = active?.kind ?? null
  const due = clock !== null && clock.due && running
  useEffect(() => {
    if (service === undefined || activeId === null || activeKind === null || !due) return
    if (completing.current === activeId) return
    completing.current = activeId
    const id = activeId
    void service.complete(id).then((next) => {
      setState(next)
      setError(null)
      const finished = next.sessions.find((session) => session.id === id)
      if (finished !== undefined && isFinished(finished)) {
        setEnded(finished)
        playSessionChime(activeKind === 'focus' ? 'focus' : 'break')
      }
    }).catch((failure: unknown) => {
      // The server's clock may still be a moment behind ours; try again shortly rather than giving up.
      console.warn('Pomodoro completion retry', { id, error: failure })
      window.setTimeout(() => { completing.current = null; setNow(Date.now()) }, 3000)
    })
  }, [service, activeId, activeKind, due])

  const next: PomodoroKind = useMemo(() => (ended === null || state === null ? 'focus' : nextKind(ended, state.sessions, state.settings)), [ended, state])

  // Preferences can start the next session on their own once the finished ring has had its beat.
  useEffect(() => {
    if (service === undefined || ended === null || state === null || active !== null || autoStarted.current === ended.id) return
    const wanted = next === 'focus' ? state.settings.autoStartFocus : state.settings.autoStartBreaks
    if (!wanted) return
    autoStarted.current = ended.id
    const timer = window.setTimeout(() => {
      void run('Could not start the next session', () => service.start({ kind: next, label: null })).then((ok) => { if (ok) setEnded(null) })
    }, 1200)
    return (): void => window.clearTimeout(timer)
  }, [service, ended, state, active, next, run])

  // A session started elsewhere clears the finished stage.
  useEffect(() => {
    if (active !== null && ended !== null) setEnded(null)
  }, [active, ended])

  const acknowledge = useCallback((): void => setEnded(null), [])

  const value = useMemo<PomodoroRuntime>(() => ({ state, loading, error, now, active, clock, ended, next, acknowledge, run, busy }), [state, loading, error, now, active, clock, ended, next, acknowledge, run, busy])
  return <RuntimeContext.Provider value={service === undefined ? null : value}>{children}</RuntimeContext.Provider>
}

const IDLE: PomodoroRuntime = {
  state: null, loading: false, error: null, now: 0, active: null, clock: null, ended: null, next: 'focus',
  acknowledge: () => undefined, run: async () => false, busy: false
}

export function usePomodoroRuntime(): PomodoroRuntime {
  return useContext(RuntimeContext) ?? IDLE
}
