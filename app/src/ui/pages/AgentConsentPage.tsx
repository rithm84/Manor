import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { AgentConnectionRequest } from '../../shared/account'
import { useShell } from '../../web/shell/ShellContext'
import { ManorLogo } from '../components/brand/ManorLogo'
import { useManorService } from '../services/ManorServices'
import { accountErrorMessage } from './welcome/accountSession'
import '../../web/access.css'

type ConsentStage =
  | { kind: 'loading' }
  | { kind: 'deciding'; authorizationId: string; request: AgentConnectionRequest }
  | { kind: 'returning'; clientName: string | null }

/** How the person gets back to the agent once Manor is done with the request. */
function returnMessage(clientName: string | null): string {
  return clientName === null
    ? 'Return to the app that asked for access to finish connecting.'
    : `Return to ${clientName} in your browser to finish connecting.`
}

/**
 * Where an agent's authorization lands: the OAuth server's site URL is this build's scheme, so the browser
 * opens `/oauth/consent` here; the decision goes back to Supabase, and the address it answers with opens in
 * the browser the agent is waiting in.
 */
export function AgentConsentPage(): ReactNode {
  const accountApi = useManorService('account')
  const shell = useShell()
  const navigate = useNavigate()
  const { search } = useLocation()
  const authorizationId = new URLSearchParams(search).get('authorization_id')
  const [stage, setStage] = useState<ConsentStage>({ kind: 'loading' })
  const [allowWrites, setAllowWrites] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    // A new request replaces whatever the previous one showed, including its error.
    setError(null)
    setStage({ kind: 'loading' })
    if (authorizationId === null) { setError('This connection request is missing its authorization ID'); return }
    void accountApi.connectionRequest(authorizationId).then(async (result) => {
      if (!active) return
      if (!('redirectUrl' in result)) { setStage({ kind: 'deciding', authorizationId, request: result }); return }
      // This account already allowed the agent, so there is nothing to decide.
      await shell.openAuthorization(result.redirectUrl)
      if (active) setStage({ kind: 'returning', clientName: null })
    }).catch((cause: unknown) => {
      if (active) setError(accountErrorMessage(cause, 'This connection request could not be read'))
    })
    return () => { active = false }
  }, [accountApi, authorizationId, shell])

  const answer = (clientName: string, decide: () => Promise<string>): void => {
    setBusy(true)
    setError(null)
    void decide().then(async (redirectUrl) => {
      await shell.openAuthorization(redirectUrl)
      setBusy(false)
      setStage({ kind: 'returning', clientName })
    }).catch((cause: unknown) => {
      setBusy(false)
      setError(accountErrorMessage(cause, 'The connection could not be completed'))
    })
  }

  return <main className="access-page">
    <ManorLogo className="access-brand" />
    <section className="access-content">
      <h1>Connect to Manor</h1>
      {stage.kind === 'deciding' && <>
        <p className="access-description"><strong>{stage.request.clientName}</strong> is requesting access to your Manor account.</p>
        <p>Read your tasks, habits, notes, mood, focus, job applications, and weekly reviews.</p>
        <label className="access-permission"><input type="checkbox" checked={allowWrites} onChange={event => setAllowWrites(event.target.checked)} disabled={busy} /> Allow updates when I ask</label>
        <p className="access-hint">You can revoke this connection in Settings.</p>
        <div className="access-actions">
          <button className="ui-button ui-button--primary" disabled={busy} data-testid="approve-mcp"
            onClick={() => answer(stage.request.clientName, () => accountApi.approveConnection(stage.authorizationId, allowWrites))}>Allow access</button>
          <button className="ui-button" disabled={busy} data-testid="deny-mcp"
            onClick={() => answer(stage.request.clientName, () => accountApi.denyConnection(stage.authorizationId))}>Cancel</button>
        </div>
      </>}
      {stage.kind === 'returning' && <p role="status" data-testid="agent-connection-answered">{returnMessage(stage.clientName)}</p>}
      {stage.kind === 'loading' && error === null && <p role="status">Loading connection details…</p>}
      {error !== null && <p role="alert" className="access-error">{error}</p>}
      {(stage.kind === 'returning' || error !== null) && <div className="access-actions">
        <button className={stage.kind === 'deciding' ? 'ui-button' : 'ui-button ui-button--primary'} disabled={busy} data-testid="back-to-manor"
          onClick={() => navigate('/home', { replace: true })}>Back to Manor</button>
      </div>}
    </section>
  </main>
}
