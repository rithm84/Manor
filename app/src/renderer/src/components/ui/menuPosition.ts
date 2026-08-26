export interface MenuPosition {
  left: number
  top: number
}

const VIEWPORT_GUTTER = 12
const TRIGGER_OFFSET = 4

/**
 * Placement for fixed-position popover menus: clamp into the viewport
 * horizontally, open below the trigger, flip above when the menu would not
 * fit underneath.
 */
export function clampMenuPosition(trigger: DOMRect, menuWidth: number, menuHeight: number): MenuPosition {
  const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - menuWidth - VIEWPORT_GUTTER)
  const left = Math.min(Math.max(trigger.left, VIEWPORT_GUTTER), maxLeft)
  const roomBelow = window.innerHeight - trigger.bottom - VIEWPORT_GUTTER
  const top = roomBelow >= menuHeight
    ? trigger.bottom + TRIGGER_OFFSET
    : Math.max(VIEWPORT_GUTTER, trigger.top - menuHeight - TRIGGER_OFFSET)
  return { left, top }
}
