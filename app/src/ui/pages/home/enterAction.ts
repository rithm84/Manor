import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Closed picker triggers: Enter would only reopen them, while Space and the arrow keys still do. */
const PICKER_TRIGGER = 'button.ui-select-trigger, [role="combobox"], button[aria-haspopup]'

/** Controls whose Enter means something of its own, from text entry to a Delete button. */
const OWN_ENTER = 'input, textarea, select, button, a[href], [role="option"], [role="radio"], [role="listbox"], [role="menu"], [contenteditable="true"]'

/**
 * Runs `action` on a plain Enter pressed anywhere in the dialog around `root` that has no
 * meaning of its own: the panel itself after a picker hands focus back, the form, or a closed
 * picker trigger. Text fields, buttons, and open pickers keep their own Enter. Listening in the
 * capture phase lets the trigger's own open handler be skipped for that key.
 */
export function useEnterAction(root: RefObject<HTMLElement | null>, active: boolean, action: () => void): void {
  const latest = useRef(action)
  latest.current = action
  useEffect(() => {
    if (!active) return
    const swallowKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() }
      document.removeEventListener('keyup', swallowKeyUp, true)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.isComposing || event.repeat) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const element = root.current
      const panel = element?.closest<HTMLElement>('[aria-modal="true"]') ?? null
      if (element === null || element === undefined || panel === null || !(event.target instanceof HTMLElement)) return
      const target = event.target
      if (target !== panel && !panel.contains(target)) return
      if (panel.querySelector('[aria-expanded="true"]') !== null) return
      const control = target === panel || target === element ? null : target.closest<HTMLElement>(OWN_ENTER)
      if (control !== null && !control.matches(PICKER_TRIGGER)) return
      event.preventDefault()
      event.stopPropagation()
      if (control !== null) document.addEventListener('keyup', swallowKeyUp, true)
      latest.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', swallowKeyUp, true)
    }
  }, [root, active])
}
