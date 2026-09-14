import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useIsFetching } from '@tanstack/react-query'

import { logRouteSettled } from './timing'

/** How long a route may stay quiet before it counts as served from cache. */
const QUIET_WINDOW_MS = 400

interface Watch {
  readonly path: string
  readonly startedAt: number
  paintedAt: number | null
  queries: number
}

/**
 * Writes one `route settled` line to the shell log per navigation: when the route's queries finish
 * and a frame is painted, or after the first painted frame when no query ran within the quiet window.
 */
export function RouteTiming(): null {
  const { pathname } = useLocation()
  const fetching = useIsFetching()
  const watch = useRef<Watch | null>(null)

  useEffect(() => {
    const current: Watch = { path: pathname, startedAt: performance.now(), paintedAt: null, queries: 0 }
    watch.current = current
    const frame = requestAnimationFrame(() => { current.paintedAt = performance.now() })
    return () => cancelAnimationFrame(frame)
  }, [pathname])

  useEffect(() => {
    const current = watch.current
    if (current === null) return
    if (fetching > 0) {
      current.queries = Math.max(current.queries, fetching)
      return
    }
    const settle = (): void => {
      if (watch.current !== current) return
      watch.current = null
      const end = current.queries > 0 ? performance.now() : (current.paintedAt ?? performance.now())
      logRouteSettled(current.path, end - current.startedAt, current.queries)
    }
    if (current.queries > 0) {
      const frame = requestAnimationFrame(settle)
      return () => cancelAnimationFrame(frame)
    }
    const timer = window.setTimeout(settle, QUIET_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [fetching, pathname])

  return null
}
