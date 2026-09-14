import { info } from '@tauri-apps/plugin-log'

/** The moments a launch passes on its way to a usable window, in the order they happen. */
export type BootMilestone = 'shell' | 'session' | 'account'

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
