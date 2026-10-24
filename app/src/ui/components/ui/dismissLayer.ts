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

/**
 * Visible dialogs, menus, and listboxes own page-level shortcuts; hidden cached modules do not.
 * A permanent page listbox opts out with `data-persistent`.
 */
export function hasOpenDismissLayer(): boolean {
  return stack.length > 0 || (typeof document !== 'undefined' && Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"]:not([data-persistent]), [role="menu"], .ui-overlay')).some(element => element.checkVisibility()))
}

/**
 * Whether a pointer target sits inside a portaled popup (Select, DatePicker, TimePicker). A popover that closes on
 * outside pointerdown must ignore these, or choosing an option unmounts the control before the choice commits.
 */
export function isInsideFloatingPopup(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.ui-popover-positioner') !== null
}
