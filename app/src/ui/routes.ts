import type { ComponentType } from 'react'

type PageModule = { default: ComponentType }

/** One loader per route so the shell can start fetching a page chunk before React asks for it. */
export const routeLoaders: Readonly<Record<string, () => Promise<PageModule>>> = {
  '/home': () => import('./pages/HomePage').then((module) => ({ default: module.HomePage })),
  '/habits': () => import('./pages/HabitsPage').then((module) => ({ default: module.HabitsPage })),
  '/mood-focus': () => import('./pages/MoodFocusPage').then((module) => ({ default: module.MoodFocusPage })),
  '/leetcode': () => import('./pages/LeetCodePage').then((module) => ({ default: module.LeetCodePage })),
  '/jobs': () => import('./pages/JobsPage').then((module) => ({ default: module.JobsPage })),
  '/notes': () => {
    // Opening Notes nearly always opens a note; fetch the editor chunk alongside the page instead of after it.
    void import('./pages/notes/RichNoteEditor')
    return import('./pages/NotesPage').then((module) => ({ default: module.NotesPage }))
  },
  '/bookmarks': () => import('./pages/BookmarksPage').then((module) => ({ default: module.BookmarksPage })),
  '/weekly-reviews': () => import('./pages/WeeklyReviewsPage').then((module) => ({ default: module.WeeklyReviewsPage })),
  '/settings': () => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))
}

export function preloadRoute(pathname: string): void {
  const loader = routeLoaders[pathname]
  if (loader !== undefined) void loader()
}
