import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ManorServices } from '../ui/services/ManorServices'
import { AccessPanel } from './AccessPanel'
import { AccountProvider } from './accountContext'
import type { ManorAccount } from './accountContext'
import { cachedAccount, completeSignIn, loadAccount } from './auth'
import { BootSplash } from './BootSplash'
import { ManorGateway } from './ManorGateway'
import { MirrorStore } from './mirror/MirrorStore'
import { MirrorSync } from './mirror/MirrorSync'
import { NoteDraftStore } from './notes/NoteDraftStore'
import { AUTH_CALLBACK_ROUTE } from './shell/deepLinks'
import type { DesktopShell } from './shell/DesktopShell'
import type { RouteRequest } from './shell/DeepLinkNavigation'
import { logBootMilestone } from './shell/timing'
import { createServices } from './services/createServices'
import { prefetchRoute } from './prefetch'
import { preloadRoute } from '../ui/routes'

interface ReadyAccount { account: ManorAccount; services: ManorServices; gateway: ManorGateway }
const loadApp = (): Promise<typeof import('../ui/App')> => import('../ui/App')
const App = lazy(() => loadApp().then(module => ({ default: module.App })))

function SignedInManor({ session, client, queries, shell, routeRequest, onRouteApplied }: { session: Session; client: SupabaseClient; queries: QueryClient; shell: DesktopShell; routeRequest: RouteRequest | null; onRouteApplied: () => void }): ReactNode {
  const [ready, setReady] = useState<ReadyAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [connected, setConnected] = useState(navigator.onLine)
  useEffect(() => {
    const update = (event: Event): void => {
      if (event instanceof CustomEvent && typeof event.detail?.connected === 'boolean') setConnected(event.detail.connected)
    }
    const offline = (): void => setConnected(false)
    window.addEventListener('manor:connection', update)
    window.addEventListener('offline', offline)
    return () => { window.removeEventListener('manor:connection', update); window.removeEventListener('offline', offline) }
  }, [])
  useEffect(() => {
    let active = true
    let drafts: NoteDraftStore | null = null
    let sync: MirrorSync | null = null
    const gateway = new ManorGateway(client, queries, session.user.id)
    const store = new MirrorStore()
    // The mirror opens before the first page read so a relaunch answers from disk instead of the network.
    const startMirror = (timezone: string): void => {
      if (sync !== null || !active) return
      const started = new MirrorSync(gateway, store, client, timezone)
      const opening = started.start()
      sync = started
      gateway.attachMirror(started)
      void opening
        .then((status) => logBootMilestone('mirror', shell.launchedAt, {
          ready: String(status.ready), rows: String(Object.values(status.rowCounts).reduce((total, count) => total + count, 0))
        }))
        .catch((cause: unknown) => console.error('Manor could not start the local mirror', { accountId: session.user.id, cause }))
    }
    const initialize = async (): Promise<void> => {
      // The shell, the current page's chunk, and the account load are independent; start them together.
      void loadApp()
      preloadRoute(location.pathname)
      drafts = await NoteDraftStore.open(indexedDB)
      const email = session.user.email
      if (!email) throw new Error('Your Google account did not provide an email address')
      const name = typeof session.user.user_metadata.full_name === 'string' ? session.user.user_metadata.full_name : email.split('@')[0]
      const services = createServices(gateway, drafts, shell, store)
      const open = (account: ManorAccount, cached: boolean): void => {
        prefetchRoute(services, account, location.pathname)
        setReady({ account, gateway, services })
        logBootMilestone('account', shell.launchedAt, { cached: String(cached) })
      }
      // A device that opened this account before renders at once; the profile round trip reconciles name and time zone afterwards.
      const cached = cachedAccount(session.user.id, email)
      if (cached !== null && active) { startMirror(cached.timezone); open(cached, true) }
      const account = await loadAccount(gateway, email, name)
      if (!active) { drafts.close(); return }
      startMirror(account.timezone)
      sync?.setAccountTimezone(account.timezone)
      if (cached === null) open(account, false)
      else if (account.name !== cached.name || account.timezone !== cached.timezone) setReady((current) => current === null ? current : { ...current, account })
    }
    void initialize().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Account setup failed') })
    return () => { active = false; drafts?.close(); sync?.stop(); gateway.attachMirror(null) }
  }, [client, queries, session.user.id, attempt, shell])

  if (error) return <main className="web-status"><h1>Manor could not open your account</h1><p role="alert">{error}</p><button className="ui-button" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Try again</button></main>
  if (!ready) return <BootSplash />
  return <AccountProvider account={ready.account}>{!connected && <p className="web-connection-status" role="status">Offline. Notes edits are protected on this device until they sync.</p>}<Suspense fallback={<BootSplash />}><App services={ready.services} shell={shell} routeRequest={routeRequest} onRouteApplied={onRouteApplied} /></Suspense></AccountProvider>
}

export function ManorApplication({ client, queries, shell }: { client: SupabaseClient; queries: QueryClient; shell: DesktopShell }): ReactNode {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // A refused sign-in arrives on the deep link that ends the attempt.
  const [signInError, setSignInError] = useState<string | null>(null)
  // Deep links have one subscriber: sign-in callbacks complete the session here, and every other route waits
  // as a request until the signed-in router exists to apply it.
  const [routeRequest, setRouteRequest] = useState<RouteRequest | null>(null)
  const clearRouteRequest = useCallback((): void => setRouteRequest(null), [])
  useEffect(() => {
    let active = true
    const stop = shell.onRoute((route) => {
      if (!route.startsWith(AUTH_CALLBACK_ROUTE)) { setRouteRequest({ route }); return }
      setSignInError(null)
      void completeSignIn(client, route).catch((cause: unknown) => {
        if (active) setSignInError(cause instanceof Error ? cause.message : 'Sign-in could not be completed')
      })
    })
    return () => { active = false; stop() }
  }, [client, shell])
  useEffect(() => {
    let active = true
    const { data: listener } = client.auth.onAuthStateChange((_event, current) => {
      if (active) setSession(current)
    })
    void client.auth.getSession().then(({ data, error: failure }) => {
      if (!active) return
      if (failure) setError(failure.message)
      else {
        logBootMilestone('session', shell.launchedAt, { signed_in: String(data.session !== null) })
        setSession(data.session)
      }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [client, shell])
  useEffect(() => { if (session === null) queries.clear() }, [session, queries])
  return <QueryClientProvider client={queries}>
    {error ? <main className="web-status" role="alert">{error}</main>
      : session === undefined ? <BootSplash />
      : session === null ? <AccessPanel client={client} shell={shell} signInError={signInError} />
      : <SignedInManor key={session.user.id} session={session} client={client} queries={queries} shell={shell} routeRequest={routeRequest} onRouteApplied={clearRouteRequest} />}
  </QueryClientProvider>
}
