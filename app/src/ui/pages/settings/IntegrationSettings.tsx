import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CalendarAccount } from '../../../shared/calendar'
import type { XConnectionStatus } from '../../../shared/xConnection'
import { useManorAccount } from '../../../web/accountContext'
import { useManorService } from '../../services/ManorServices'
import { Button } from '../../components/ui'
import { SettingsRow, SettingsToggle } from './controls'

export function IntegrationSettings(): ReactNode {
  const calendarApi = useManorService('gcal')
  const xApi = useManorService('x')
  const account = useManorAccount()
  const [accounts, setAccounts] = useState<readonly CalendarAccount[]>([])
  const [xConnection, setXConnection] = useState<XConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const completing = useRef(false)
  const { data: calendars = [], error: calendarError, refetch: refreshCalendars } = useQuery({
    queryKey: ['manor', account.id, 'integration-calendars'],
    queryFn: () => calendarApi.calendars(),
    enabled: accounts.length > 0 && !busy,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const load = useCallback(async (): Promise<void> => {
    const [nextAccounts, , nextX] = await Promise.all([calendarApi.accounts(), refreshCalendars({ throwOnError: true }), xApi.status()])
    setAccounts(nextAccounts)
    setXConnection(nextX)
    setLoading(false)
  }, [calendarApi, refreshCalendars, xApi])
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try { await action(); await load() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('connection_code')
    const state = params.get('connection_state')
    const provider = params.get('connection_provider')
    const failure = params.get('connection_error')
    if ((code !== null && state !== null) || failure !== null) {
      if (completing.current) return
      completing.current = true
      window.history.replaceState(null, '', window.location.pathname)
      if (failure !== null) { setError(failure); void load().catch((cause: unknown) => { setLoading(false); setError(`${failure}. ${cause instanceof Error ? cause.message : String(cause)}`) }); return }
      setBusy(true)
      const api = provider === 'x' ? xApi : calendarApi
      void api.completeConnection(code!, state!).then(() => { setNotice('Account connected. Your content will appear as it syncs.'); return load() })
        .catch((cause: unknown) => { setLoading(false); setError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => setBusy(false))
      return
    }
    void load().catch((cause: unknown) => { setLoading(false); setError(cause instanceof Error ? cause.message : String(cause)) })
  }, [calendarApi, load, xApi])
  return <section className="set-section">
    <h2 className="set-section-title">Connections</h2>
    {error !== null ? <p className="set-signin-error" role="alert">{error}</p> : null}
    {calendarError !== null && error === null ? <p className="set-signin-error" role="alert">Could not refresh calendars: {calendarError.message}</p> : null}
    {notice !== null ? <p className="set-integration-notice" role="status">{notice}</p> : null}
    {loading ? <p>Loading connections…</p> : <>
      <div className="set-card">
        <SettingsRow label="Google Calendar" description="See your calendars on Home. Your events stay in Google Calendar.">
          <Button variant="ghost" data-testid="connect-google" disabled={busy} onClick={() => void run(() => calendarApi.connect())}>{accounts.length > 0 ? 'Connect another account' : 'Connect Google'}</Button>
        </SettingsRow>
        {accounts.map((account) => <div className="set-connected-account" key={account.id}>
          <SettingsRow label={account.email} description="Connected Google account">
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => calendarApi.disconnect(account.id))}>Disconnect</Button>
          </SettingsRow>
          {calendars.filter((calendar) => calendar.accountId === account.id).map((calendar) => <SettingsRow key={calendar.id} label={calendar.name} description="Show on Home">
            <SettingsToggle checked={calendar.enabled} onChange={(enabled) => { if (!busy) void run(() => calendarApi.setCalendarEnabled(calendar.id, account.id, enabled)) }} ariaLabel={`Show ${calendar.name} on Home`} />
          </SettingsRow>)}
        </div>)}
      </div>
      <div className="set-card">
        <SettingsRow label="X bookmarks" description={xConnection?.connected ? `Connected as @${xConnection.username}` : 'Bring your bookmarked posts into your knowledge base.'}>
          {xConnection?.connected ? <Button variant="ghost" disabled={busy} onClick={() => void run(() => xApi.disconnect())}>Disconnect</Button> : <Button variant="ghost" data-testid="connect-x" disabled={busy} onClick={() => void run(() => xApi.connect())}>Connect X</Button>}
        </SettingsRow>
        {xConnection?.connected ? <SettingsRow label="Sync bookmarks" description="Bookmarks are kept even if you disconnect.">
          <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { const result = await xApi.ingestNow(); setNotice(`${result.added} new bookmarks saved.`) })}>Sync now</Button>
        </SettingsRow> : null}
      </div>
    </>}
  </section>
}
