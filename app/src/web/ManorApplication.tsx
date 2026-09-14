import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ManorServices } from '../ui/services/ManorServices'
import { AccessPanel } from './AccessPanel'
import { AccountProvider } from './accountContext'
import type { ManorAccount } from './accountContext'
import { loadAccount } from './auth'
import { ManorGateway } from './ManorGateway'
import { NoteDraftStore } from './notes/NoteDraftStore'
import { createServices } from './services/createServices'
import { OAuthConsent } from './OAuthConsent'
import { prefetchRoute } from './prefetch'
import { preloadRoute } from '../ui/routes'

interface ReadyAccount { account: ManorAccount; services: ManorServices; gateway: ManorGateway }
const loadApp = (): Promise<typeof import('../ui/App')> => import('../ui/App')
const App = lazy(() => loadApp().then(module => ({ default: module.App })))

function SignedInManor({ session, client, queries }: { session: Session; client: SupabaseClient; queries: QueryClient }): ReactNode {
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
    const gateway = new ManorGateway(client, queries, session.user.id)
    const initialize = async (): Promise<void> => {
      // The shell, the current page's chunk, and the account load are independent; start them together.
      void loadApp()
      preloadRoute(location.pathname)
      drafts = await NoteDraftStore.open(indexedDB)
      const email = session.user.email
      if (!email) throw new Error('Your Google account did not provide an email address')
      const name = typeof session.user.user_metadata.full_name === 'string' ? session.user.user_metadata.full_name : email.split('@')[0]
      const account = await loadAccount(gateway, email, name)
      const services = createServices(gateway, drafts)
      if (active) { prefetchRoute(services, account, location.pathname); setReady({ account, gateway, services }) }
      else drafts.close()
    }
    void initialize().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Account setup failed') })
    return () => { active = false; drafts?.close() }
  }, [client, queries, session.user.id, attempt])

  useEffect(() => {
    if (!ready) return
    const channel = client.channel(`manor:${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'action_events', filter: `user_id=eq.${session.user.id}` }, payload => {
        if ('command_id' in payload.new && typeof payload.new.command_id === 'string' && ready.gateway.issuedCommand(payload.new.command_id)) return
        const operation = 'operation' in payload.new && typeof payload.new.operation === 'string' ? payload.new.operation : 'remote_change'
        void ready.gateway.invalidateOperation(operation).then(() => window.dispatchEvent(new CustomEvent('manor:committed', { detail: { operation } })))
      }).subscribe(status => {
        if (status === 'CHANNEL_ERROR') console.error('Manor realtime subscription failed', { accountId: session.user.id })
      })
    return () => { void client.removeChannel(channel) }
  }, [client, ready, session.user.id])

  if (error) return <main className="web-status"><h1>Manor could not open your account</h1><p role="alert">{error}</p><button className="ui-button" onClick={() => { setError(null); setAttempt(attempt + 1) }}>Try again</button></main>
  if (!ready) return <main className="web-status" role="status">Opening Manor…</main>
  if (location.pathname === '/oauth/consent') return <OAuthConsent client={client} />
  return <AccountProvider account={ready.account}>{!connected && <p className="web-connection-status" role="status">Offline. Notes edits are protected on this device until they sync.</p>}<Suspense fallback={<main className="web-status" role="status">Opening Manor…</main>}><App services={ready.services} /></Suspense></AccountProvider>
}

export function ManorApplication({ client, queries }: { client: SupabaseClient; queries: QueryClient }): ReactNode {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const { data: listener } = client.auth.onAuthStateChange((_event, current) => {
      if (active) {
        if (current && location.pathname === '/auth/callback') {
          const returnTo = sessionStorage.getItem('manor.auth.return')
          sessionStorage.removeItem('manor.auth.return')
          history.replaceState(null, '', returnTo?.startsWith('/oauth/consent?authorization_id=') ? returnTo : '/home')
        }
        setSession(current)
      }
    })
    void client.auth.getSession().then(({ data, error: failure }) => {
      if (!active) return
      if (failure) setError(failure.message)
      else setSession(data.session)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [client])
  useEffect(() => { if (session === null) queries.clear() }, [session, queries])
  return <QueryClientProvider client={queries}>
    {error ? <main className="web-status" role="alert">{error}</main>
      : session === undefined ? <main className="web-status" role="status">Opening Manor…</main>
      : session === null ? <AccessPanel client={client} />
      : <SignedInManor key={session.user.id} session={session} client={client} queries={queries} />}
  </QueryClientProvider>
}
