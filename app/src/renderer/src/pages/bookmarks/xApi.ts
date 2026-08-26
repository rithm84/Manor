import type { XApi } from '../../../../shared/xConnection'

/**
 * Typed accessor for the X bridge. The shell wires window.manor.x; until
 * env.d.ts declares it, this cast keeps callers typed against XApi and lets
 * surfaces degrade gracefully when the bridge is not present.
 */
export function xApiOf(): XApi | null {
  const manor = window.manor as typeof window.manor & { x?: XApi }
  return manor.x ?? null
}
