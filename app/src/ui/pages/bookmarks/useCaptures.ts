import { useManorService } from '../../services/ManorServices'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { KbEntry } from '../../../shared/kb'
import { hasPendingCaptures } from './captures'

const POLL_INTERVAL_MS = 5000
/** 12 polls at 5s covers about a minute of processing, then polling stops. */
const POLL_BUDGET = 12

export type CapturesState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; entries: readonly KbEntry[]; notice: string | null }

export interface CapturesController {
  state: CapturesState
  reload: () => void
  /** Deletes the entry from the knowledge base; rejects with the API error on failure. */
  removeCapture: (entryId: string) => Promise<void>
  /** Re-runs processing for a failed entry and restarts the pending poll. */
  retryCapture: (entryId: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Knowledge-base entries for the Bookmarks page: loads on mount (signed-in
 * only) and re-polls while entries are pending, within a fixed budget.
 */
export function useCaptures(): CapturesController {
  const accountApi = useManorService('account')
  const kbApi = useManorService('kb')
  const [state, setState] = useState<CapturesState>({ kind: 'loading' })
  const pollsLeftRef = useRef(0)
  const pollTimerRef = useRef<number | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return (): void => {
      aliveRef.current = false
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' })
    try {
      const account = await accountApi.current()
      if (!aliveRef.current) return
      if (account === null) {
        setState({ kind: 'signedOut' })
        return
      }
      const entries = await kbApi.list()
      if (!aliveRef.current) return
      pollsLeftRef.current = POLL_BUDGET
      setState({ kind: 'ready', entries, notice: null })
    } catch (error) {
      if (!aliveRef.current) return
      setState({ kind: 'error', message: errorMessage(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // While anything is pending, refresh every few seconds until the budget runs out.
  useEffect(() => {
    if (state.kind !== 'ready' || !hasPendingCaptures(state.entries) || pollsLeftRef.current <= 0) {
      return
    }
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null
      pollsLeftRef.current -= 1
      kbApi.list().then(
        (entries) => {
          if (!aliveRef.current) return
          setState({ kind: 'ready', entries, notice: null })
        },
        (error: unknown) => {
          if (!aliveRef.current) return
          setState((previous) =>
            previous.kind === 'ready' ? { ...previous, notice: errorMessage(error) } : previous
          )
        }
      )
    }, POLL_INTERVAL_MS)
    return (): void => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [state])

  const reload = useCallback((): void => {
    void load()
  }, [load])

  const removeCapture = useCallback(async (entryId: string): Promise<void> => {
    await kbApi.remove(entryId)
    if (!aliveRef.current) return
    setState((previous) =>
      previous.kind === 'ready'
        ? { ...previous, entries: previous.entries.filter((entry) => entry.id !== entryId) }
        : previous
    )
  }, [])

  const retryCapture = useCallback(async (entryId: string): Promise<void> => {
    pollsLeftRef.current = POLL_BUDGET
    setState((previous) =>
      previous.kind === 'ready'
        ? {
            ...previous,
            notice: null,
            entries: previous.entries.map((entry) =>
              entry.id === entryId ? { ...entry, status: 'pending' as const, error: null } : entry
            )
          }
        : previous
    )
    try {
      await kbApi.retryProcessing(entryId)
    } catch (error) {
      if (!aliveRef.current) return
      const message = errorMessage(error)
      setState((previous) =>
        previous.kind === 'ready'
          ? {
              ...previous,
              entries: previous.entries.map((entry) =>
                entry.id === entryId
                  ? { ...entry, status: 'failed' as const, error: message }
                  : entry
              )
            }
          : previous
      )
    }
  }, [])

  return { state, reload, removeCapture, retryCapture }
}
