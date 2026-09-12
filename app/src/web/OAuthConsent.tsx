import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient, OAuthAuthorizationDetails } from '@supabase/supabase-js'
import { z } from 'zod'
import { ManorLogo } from '../ui/components/brand/ManorLogo'

export function OAuthConsent({ client }: { client: SupabaseClient }): ReactNode {
  const authorizationId = new URLSearchParams(location.search).get('authorization_id')
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null)
  const [canWrite, setCanWrite] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!authorizationId) { setError('This connection request is missing its authorization ID'); return }
    void client.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: failure }) => {
      if (!active) return
      if (failure) setError(failure.message)
      else if (data && 'redirect_url' in data) location.assign(data.redirect_url)
      else if (data) setDetails(data)
    })
    return () => { active = false }
  }, [authorizationId, client])

  const approve = async (): Promise<void> => {
    if (!details || !authorizationId) throw new Error('The connection request is not ready')
    const grant = await client.rpc('manor_authorize_mcp_client', { p_client_id: z.uuid().parse(details.client.id), p_write: canWrite })
    if (grant.error) throw grant.error
    const approval = await client.auth.oauth.approveAuthorization(authorizationId)
    if (approval.error) throw approval.error
  }
  const deny = async (): Promise<void> => {
    if (!authorizationId) throw new Error('The connection request is missing')
    const denied = await client.auth.oauth.denyAuthorization(authorizationId)
    if (denied.error) throw denied.error
  }
  const perform = (action: () => Promise<void>): void => {
    setBusy(true); setError(null)
    void action().catch((cause: unknown) => { setBusy(false); setError(cause instanceof Error ? cause.message : 'The connection could not be completed') })
  }

  return <main className="access-page">
    <ManorLogo className="access-brand" />
    <section className="access-content">
      <h1>Connect to Manor</h1>
      {details ? <>
        <p className="access-description"><strong>{details.client.name}</strong> is requesting access to your Manor account.</p>
        <p>Read your tasks, habits, notes, mood, focus, job applications, and weekly reviews.</p>
        <label className="access-permission"><input type="checkbox" checked={canWrite} onChange={event => setCanWrite(event.target.checked)} disabled={busy} /> Allow updates when I ask</label>
        <p className="access-hint">Your private Journal is excluded. You can revoke this connection in Settings.</p>
        <p className="access-hint">Return address: {details.redirect_uri}</p>
        <div className="access-actions">
          <button className="ui-button ui-button--primary" disabled={busy} onClick={() => perform(approve)} data-testid="approve-mcp">Allow access</button>
          <button className="ui-button" disabled={busy} onClick={() => perform(deny)} data-testid="deny-mcp">Cancel</button>
        </div>
      </> : !error && <p role="status">Loading connection details…</p>}
      {error && <p role="alert" className="access-error">{error}</p>}
    </section>
  </main>
}
