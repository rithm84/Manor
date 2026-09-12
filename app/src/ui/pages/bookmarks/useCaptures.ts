import { useManorService } from '../../services/ManorServices'
import { useCommitVersion } from '../../services/useCommitVersion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KbEntry } from '../../../shared/kb'
import { hasPendingCaptures } from './captures'

const POLL_INTERVAL_MS = 5000
const POLL_BUDGET = 12

export type CapturesState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; entries: readonly KbEntry[]; notice: string | null }

export interface CapturesController {
  state: CapturesState
  reload: () => void
  removeCapture: (entryId: string) => Promise<void>
  retryCapture: (entryId: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Authenticated entries refresh after commits; pending processing uses a bounded poll. */
export function useCaptures(): CapturesController {
  const kbApi = useManorService('kb')
  const commitVersion = useCommitVersion()
  const [state, setState] = useState<CapturesState>({ kind: 'loading' })
  const pollsLeftRef = useRef(0)
  const pollTimerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)
  const generationRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return (): void => {
      aliveRef.current = false
      generationRef.current += 1
      if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current
    if (pollTimerRef.current !== null) { window.clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    setState((previous) => previous.kind === 'ready' ? previous : { kind: 'loading' })
    try {
      const entries = await kbApi.list()
      if (!aliveRef.current || generation !== generationRef.current) return
      pollsLeftRef.current = POLL_BUDGET
      setState({ kind: 'ready', entries, notice: null })
    } catch (error) {
      if (!aliveRef.current || generation !== generationRef.current) return
      setState((previous) => previous.kind === 'ready'
        ? { ...previous, notice: errorMessage(error) }
        : { kind: 'error', message: errorMessage(error) })
    }
  }, [kbApi])

  useEffect(() => { void load() }, [load, commitVersion])

  useEffect(() => {
    if (state.kind !== 'ready' || !hasPendingCaptures(state.entries) || pollsLeftRef.current <= 0) return
    const generation = generationRef.current
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null
      pollsLeftRef.current -= 1
      void kbApi.list().then(
        (entries) => {
          if (!aliveRef.current || generation !== generationRef.current) return
          setState({ kind: 'ready', entries, notice: null })
        },
        (error: unknown) => {
          if (!aliveRef.current || generation !== generationRef.current) return
          setState((previous) => previous.kind === 'ready' ? { ...previous, notice: errorMessage(error) } : previous)
        }
      )
    }, POLL_INTERVAL_MS)
    return (): void => {
      if (pollTimerRef.current !== null) { window.clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    }
  }, [state, kbApi])

  const reload = useCallback((): void => { void load() }, [load])
  const removeCapture = useCallback(async (entryId: string): Promise<void> => {
    await kbApi.remove(entryId)
    if (!aliveRef.current) return
    setState((previous) => previous.kind === 'ready'
      ? { ...previous, entries: previous.entries.filter((entry) => entry.id !== entryId) }
      : previous)
  }, [kbApi])

  const retryCapture = useCallback(async (entryId: string): Promise<void> => {
    try {
      await kbApi.retryProcessing(entryId)
      if (!aliveRef.current) return
      await load()
    } catch (error) {
      if (!aliveRef.current) return
      const message = errorMessage(error)
      setState((previous) => previous.kind === 'ready'
        ? { ...previous, notice: message, entries: previous.entries.map((entry) => entry.id === entryId ? { ...entry, status: 'failed' as const, error: message } : entry) }
        : { kind: 'error', message })
    }
  }, [kbApi, load])

  return { state, reload, removeCapture, retryCapture }
}
