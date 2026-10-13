import { info } from '@tauri-apps/plugin-log'

/** The moments a launch passes on its way to a usable window, in the order they happen. */
export type BootMilestone = 'shell' | 'session' | 'account' | 'mirror'

function record(message: string, fields: Record<string, string>): void {
  void info(message, { keyValues: fields }).catch((cause: unknown) => console.error('Manor could not write to the shell log', { cause }))
}

/**
 * Records a boot milestone in the shell log with how long it took since the process started
 * (`since_launch_ms`) and since the document began loading (`since_navigation_ms`).
 */
export function logBootMilestone(milestone: BootMilestone, launchedAt: number, detail: Record<string, string>): void {
  record('boot', {
    milestone,
    ...detail,
    since_launch_ms: String(Math.max(0, Date.now() - launchedAt)),
    since_navigation_ms: String(Math.round(performance.now()))
  })
}

/** Records how long a route took from the navigation to its data settling on a painted frame. */
export function logRouteSettled(path: string, elapsedMs: number, queries: number): void {
  record('route settled', { path, ms: String(Math.round(elapsedMs)), queries: String(queries) })
}

/** The performance mark each navigation leaves, so a page can time its own content from the route change. */
const ROUTE_MARK = 'manor:route'

/** Marks the start of a navigation, keeping only the latest mark. */
export function markRouteStart(): void {
  performance.clearMarks(ROUTE_MARK)
  performance.mark(ROUTE_MARK)
}

/** Milliseconds since the latest navigation started. */
export function sinceRouteStart(): number {
  const mark = performance.getEntriesByName(ROUTE_MARK, 'mark').at(-1)
  if (mark === undefined) throw new Error('No navigation has been marked, so there is nothing to time from')
  return performance.now() - mark.startTime
}

/** Records one Problems step, such as `library` or `run`, with the milliseconds it took. */
export function logProblemTiming(step: string, elapsedMs: number, detail: Record<string, string>): void {
  record('problems timed', { step, ms: String(Math.round(elapsedMs)), ...detail })
}

/** Records why a Problems benchmark drive stopped, so the benchmark fails at once instead of timing out. */
export function logProblemBenchmarkFailure(reason: string): void {
  record('problems benchmark failed', { reason })
}
