import { useEffect } from 'react'

import { hasOpenDismissLayer } from '../components/ui'

/** Page routes in sidebar order; Cmd+1 through Cmd+9 open them. */
export const PAGE_ROUTES: readonly string[] = [
  '/home',
  '/habits',
  '/mood-focus',
  '/pomodoro',
  '/leetcode',
  '/jobs',
  '/notes',
  '/weekly-reviews',
  '/bookmarks'
]

/** The Command key on macOS, Control elsewhere; Option and Shift are never part of these shortcuts. */
export function isCommandKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}

/** Whether the key press is typing into a field or editor, where page shortcuts stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

/** Whether a dialog, menu, or popup is up, which owns the keyboard until it closes. */
export function overlayOpen(): boolean {
  return hasOpenDismissLayer() || document.querySelector('.ui-overlay') !== null
}

/** The page's number shortcut: Cmd+1 opens the first sidebar page, and so on. `null` for other keys. */
export function routeForShortcut(event: KeyboardEvent): string | null {
  if (!isCommandKey(event)) return null
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null)
  if (digit === null) return null
  return PAGE_ROUTES[Number(digit) - 1] ?? null
}

/** Whether the press is Cmd+\ (toggle the sidebar). */
export function isSidebarShortcut(event: KeyboardEvent): boolean {
  return isCommandKey(event) && (event.code === 'Backslash' || event.key === '\\')
}

/** Whether the press is Cmd+N (create on the current page). */
export function isCreateShortcut(event: KeyboardEvent): boolean {
  return isCommandKey(event) && (event.code === 'KeyN' || event.key.toLowerCase() === 'n')
}

export interface GlobalShortcutHandlers {
  navigate: (route: string) => void
  toggleSidebar: () => void
}

/**
 * Frame-level shortcuts: Cmd+1 to Cmd+9 switch pages and Cmd+\ toggles the
 * sidebar. They work while typing, since neither inserts text, but they wait
 * while a dialog or menu is open.
 */
export function useGlobalShortcuts({ navigate, toggleSidebar }: GlobalShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      if (isSidebarShortcut(event)) {
        event.preventDefault()
        toggleSidebar()
        return
      }
      const route = routeForShortcut(event)
      if (route === null || overlayOpen()) return
      event.preventDefault()
      navigate(route)
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, toggleSidebar])
}

/**
 * Cmd+N runs the page's create action (a task on Home, a habit on Habits, a
 * role on Jobs) when focus is not in a field and nothing is open above the page.
 */
export function useCreateShortcut(create: (() => void) | null): void {
  useEffect(() => {
    if (create === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || !isCreateShortcut(event)) return
      if (isTypingTarget(event.target) || overlayOpen()) return
      event.preventDefault()
      create()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [create])
}
