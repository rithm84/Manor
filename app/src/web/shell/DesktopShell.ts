import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { z } from 'zod'

import { AUTH_CALLBACK_ROUTE, deepLinkRoute } from './deepLinks'

type RouteHandler = (route: string) => void

const schemeSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'A desktop URL scheme starts with a letter and holds lowercase letters, digits, and hyphens')

/** What the shell reports about itself: the scheme this build owns and when the process started. */
const infoSchema = z.object({ scheme: schemeSchema, launchedAtMs: z.number().int().positive() })

/** An address outside Manor over http(s); the app's own origin, including fragments within a page, is `null`. */
export function departingUrl(candidate: string | URL | null | undefined): string | null {
  if (candidate === null || candidate === undefined || candidate === '') return null
  let destination: URL
  try {
    destination = new URL(candidate, location.href)
  } catch {
    return null
  }
  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') return null
  return destination.origin === location.origin ? null : destination.href
}

/** The link a click would leave Manor for. */
function departingLink(target: EventTarget | null): string | null {
  const anchor = target instanceof Element ? target.closest('a') : null
  if (anchor === null || anchor.getAttribute('href') === null) return null
  return departingUrl(anchor.href)
}

/**
 * The window's own fragment, when `window.open` is asked for an address inside the running page. The note
 * editor's link toolbar opens links this way, so a table of contents entry has to travel back to the editor.
 */
export function ownFragment(candidate: string | URL | null | undefined): string | null {
  if (candidate === null || candidate === undefined || candidate === '') return null
  try {
    const destination = new URL(candidate, location.href)
    return destination.origin === location.origin && destination.pathname === location.pathname && destination.hash !== '' ? destination.hash : null
  } catch {
    return null
  }
}

/**
 * Sends departing addresses to the system browser whether they arrive as clicks or as `window.open` calls,
 * which the embedded webview otherwise drops. A click that the editor also relays through `window.open`
 * opens once: the second request for the same address inside a moment is ignored.
 */
export function installLinkRouting(open: (url: string) => Promise<void>, relayFragment: (fragment: string) => void): void {
  let recent: { url: string; at: number } | null = null
  const openOnce = (url: string): void => {
    const now = performance.now()
    if (recent !== null && recent.url === url && now - recent.at < 500) return
    recent = { url, at: now }
    void open(url).catch((cause: unknown) => console.error('Manor could not open a link in the browser', { cause }))
  }
  // Capture phase: a link inside a clickable row stops the click from bubbling so the row stays put, and that
  // must not keep the link itself from opening.
  document.addEventListener('click', (event) => {
    const departing = departingLink(event.target)
    if (departing === null) return
    event.preventDefault()
    openOnce(departing)
  }, { capture: true })
  window.open = (url?: string | URL): Window | null => {
    const departing = departingUrl(url)
    if (departing !== null) openOnce(departing)
    else {
      const fragment = ownFragment(url)
      if (fragment !== null) relayFragment(fragment)
    }
    return null
  }
}

/** Routes received by the shell, held for the first subscriber while nobody is listening. */
class RouteInbox {
  private readonly pending: string[] = []
  private handler: RouteHandler | null = null

  deliver(route: string): void {
    if (this.handler === null) this.pending.push(route)
    else this.handler(route)
  }

  subscribe(handler: RouteHandler): () => void {
    if (this.handler !== null) throw new Error('Manor routes deep links to one subscriber at a time')
    this.handler = handler
    for (const route of this.pending.splice(0)) handler(route)
    return () => {
      if (this.handler === handler) this.handler = null
    }
  }
}

/** The Tauri window: authorization and outside links open in the system browser, routes arrive as deep links. */
export class DesktopShell {
  /** The URL scheme this build owns, which is also how a link reaches it from outside. */
  readonly scheme: string
  /** Where Supabase Auth returns after Google sign-in. */
  readonly authRedirectUrl: string
  /** When the process started, as milliseconds since the Unix epoch; boot milestones are measured from it. */
  readonly launchedAt: number
  private readonly inbox: RouteInbox

  constructor(scheme: string, launchedAt: number, inbox: RouteInbox) {
    this.scheme = scheme
    this.launchedAt = launchedAt
    this.inbox = inbox
    this.authRedirectUrl = `${scheme}://${AUTH_CALLBACK_ROUTE.slice(1)}`
  }

  /** An address that opens this build at `route`, for links that are copied or followed outside the window. */
  appUrl(route: string): string {
    return `${this.scheme}://${route.replace(/^\/+/, '')}`
  }

  /** Sends the person to an authorization page in the system browser, which embedded webviews cannot serve. */
  openAuthorization(url: string): Promise<void> {
    return openUrl(url)
  }

  /**
   * Routes the shell delivers, including the one the app was launched with; a route that arrived before any
   * handler existed reaches the first one that subscribes. Returns the unsubscribe function.
   */
  onRoute(handler: RouteHandler): () => void {
    return this.inbox.subscribe(handler)
  }

  /** Shows the window once its first frame is ready. */
  async revealWindow(): Promise<void> {
    const main = getCurrentWindow()
    await main.show()
    await main.setFocus()
  }
}

/**
 * Builds the shell: the URL scheme this build owns, the deep-link inbox that feeds routes to the app,
 * and the click handler that sends departing links to the system browser. The plugin's event only covers
 * links that arrive after the listener exists, and the link the app was launched with is only available
 * through `getCurrent`, so the listener is installed first and the launch link is added unless the
 * listener already saw it.
 */
export async function createDesktopShell(): Promise<DesktopShell> {
  const { scheme, launchedAtMs } = infoSchema.parse(await invoke<unknown>('desktop_info'))
  const inbox = new RouteInbox()
  const seenWhileBooting = new Set<string>()
  let booting = true
  await onOpenUrl((urls) => {
    for (const url of urls) {
      if (booting) seenWhileBooting.add(url)
      inbox.deliver(deepLinkRoute(url, scheme))
    }
  })
  for (const url of (await getCurrent()) ?? []) {
    if (!seenWhileBooting.has(url)) inbox.deliver(deepLinkRoute(url, scheme))
  }
  booting = false
  seenWhileBooting.clear()
  installLinkRouting(openUrl, (fragment) => window.dispatchEvent(new CustomEvent('manor:reveal-fragment', { detail: fragment })))
  return new DesktopShell(scheme, launchedAtMs, inbox)
}
