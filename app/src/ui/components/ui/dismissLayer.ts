import { useEffect, useRef } from 'react'

/**
 * LIFO Escape ownership for stacked dismissable surfaces (modal > select >
 * nested picker). Exactly one window listener; Escape dismisses only the
 * top-most active layer, so an open picker closes before its host dialog.
 *
 * Every layer that opens above another surface MUST register here; a layer
 * that keeps its own window Escape listener will race the stack by
 * registration order, which is the bug this replaces.
 */

interface DismissEntry {
  id: number
  onDismiss: () => void
}

const stack: DismissEntry[] = []
let nextId = 0
let listening = false

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = stack.at(-1)
  if (top === undefined) return
  event.preventDefault()
  event.stopPropagation()
  top.onDismiss()
}

function ensureListener(): void {
  if (listening) return
  listening = true
  window.addEventListener('keydown', onWindowKeyDown, { capture: true })
}

/** Registers this surface on the dismiss stack while `active` is true. */
export function useDismissLayer(active: boolean, onDismiss: () => void): void {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    ensureListener()
    const entry: DismissEntry = { id: nextId++, onDismiss: () => dismissRef.current() }
    stack.push(entry)
    return (): void => {
      const index = stack.indexOf(entry)
      if (index !== -1) stack.splice(index, 1)
    }
  }, [active])
}

/** True while any dismiss layer is open (e.g. to scope page-level shortcuts). */
export function hasOpenDismissLayer(): boolean {
  return stack.length > 0
}
