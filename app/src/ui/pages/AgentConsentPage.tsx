import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { AgentConnectionRequest } from '../../shared/account'
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
    ? 'Go back to the app that asked for access. It finishes connecting on its own.'
    : `Go back to ${clientName}. It finishes connecting on its own.`
}

/**
 * Where an agent's authorization is decided: the consent bridge page in the agent's browser window opens this
 * route, the decision goes to Supabase, and the address it answers with is handed back to that bridge page,
 * which continues in the agent's own window.
 */
export function AgentConsentPage(): ReactNode {
  const accountApi = useManorService('account')
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
      await accountApi.handOffConnection(authorizationId, result.redirectUrl)
      if (active) setStage({ kind: 'returning', clientName: null })
    }).catch((cause: unknown) => {
      if (active) setError(accountErrorMessage(cause, 'This connection request could not be read'))
    })
    return () => { active = false }
  }, [accountApi, authorizationId])

  const answer = (authorizationId: string, clientName: string, decide: () => Promise<string>): void => {
    setBusy(true)
    setError(null)
    void decide().then(async (redirectUrl) => {
      await accountApi.handOffConnection(authorizationId, redirectUrl)
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
            onClick={() => answer(stage.authorizationId, stage.request.clientName, () => accountApi.approveConnection(stage.authorizationId, allowWrites))}>Allow access</button>
          <button className="ui-button" disabled={busy} data-testid="deny-mcp"
            onClick={() => answer(stage.authorizationId, stage.request.clientName, () => accountApi.denyConnection(stage.authorizationId))}>Cancel</button>
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
