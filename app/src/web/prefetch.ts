import type { ManorServices } from '../ui/services/ManorServices'
import { dateInTimezone } from '../shared/timezone'
import type { ManorAccount } from './accountContext'

/** Start the current page's reads as soon as services exist; the page's own load reuses the same query cache entries. */
export function prefetchRoute(services: ManorServices, account: ManorAccount, pathname: string): void {
  const loaders: Readonly<Record<string, () => Promise<unknown>>> = {
    '/home': () => Promise.all([services.home.load(), services.gcal.eventsFor([dateInTimezone(new Date(), account.timezone)])]),
    '/habits': () => services.habits.load(),
    '/mood-focus': () => services.moodFocus.load(),
    '/leetcode': () => services.leetcode.load(),
    '/jobs': () => services.jobs.load(),
    '/notes': () => services.notes.load(),
    '/bookmarks': () => services.kb.list(),
    '/weekly-reviews': () => services.reviews.load()
  }
  const loader = loaders[pathname]
  if (loader !== undefined) loader().catch((error: unknown) => console.warn('Route prefetch failed; the page will report its own load', { pathname, error }))
}
