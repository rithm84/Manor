import { useSyncExternalStore } from 'react'

/**
 * Single owner of the sidebar docked/collapsed preference. Both the frame
 * toggle and Settings read and write through this store, so the two surfaces
 * stay live-synced within the window; localStorage persists across restarts.
 */

/** localStorage key for the docked/collapsed choice ('1' docked, '0' collapsed). */
const SIDEBAR_DOCKED_KEY = 'manor.sidebar.docked'
/** Same-window change signal ('storage' only fires in other windows). */
const DOCKED_CHANGE_EVENT = 'manor:sidebar-docked-change'

function readSidebarDocked(): boolean {
  return window.localStorage.getItem(SIDEBAR_DOCKED_KEY) !== '0'
}

function writeSidebarDocked(docked: boolean): void {
  window.localStorage.setItem(SIDEBAR_DOCKED_KEY, docked ? '1' : '0')
  window.dispatchEvent(new Event(DOCKED_CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(DOCKED_CHANGE_EVENT, onChange)
  return (): void => {
    window.removeEventListener(DOCKED_CHANGE_EVENT, onChange)
  }
}

/** Live docked preference; the setter updates every subscribed component. */
export function useSidebarDocked(): readonly [boolean, (docked: boolean) => void] {
  const docked = useSyncExternalStore(subscribe, readSidebarDocked)
  return [docked, writeSidebarDocked] as const
}
