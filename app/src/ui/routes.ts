import type { ComponentType } from 'react'

import { loadRichNoteEditor } from './pages/notes/loadRichNoteEditor'
import { singleFlight } from './singleFlight'

type PageModule = { default: ComponentType }

/**
 * One loader per route so the shell can start fetching a page chunk before React asks for it. The launch
 * preload and React's own request overlap, so each loader is single-flight.
 */
export const routeLoaders: Readonly<Record<string, () => Promise<PageModule>>> = {
  '/home': singleFlight(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage }))),
  '/habits': singleFlight(() => import('./pages/HabitsPage').then((module) => ({ default: module.HabitsPage }))),
  '/mood-focus': singleFlight(() => import('./pages/MoodFocusPage').then((module) => ({ default: module.MoodFocusPage }))),
  '/pomodoro': singleFlight(() => import('./pages/PomodoroPage').then((module) => ({ default: module.PomodoroPage }))),
  '/leetcode': singleFlight(() => import('./pages/LeetCodePage').then((module) => ({ default: module.LeetCodePage }))),
  '/jobs': singleFlight(() => import('./pages/JobsPage').then((module) => ({ default: module.JobsPage }))),
  '/notes': singleFlight(() => {
    // Opening Notes nearly always opens a note; fetch the editor chunk alongside the page instead of after it.
    void loadRichNoteEditor()
    return import('./pages/NotesPage').then((module) => ({ default: module.NotesPage }))
  }),
  '/bookmarks': singleFlight(() => import('./pages/BookmarksPage').then((module) => ({ default: module.BookmarksPage }))),
  '/weekly-reviews': singleFlight(() => import('./pages/WeeklyReviewsPage').then((module) => ({ default: module.WeeklyReviewsPage }))),
  '/settings': singleFlight(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
}

export function preloadRoute(pathname: string): void {
  const loader = routeLoaders[pathname]
  if (loader !== undefined) void loader()
}
