import { useEffect, useState, type ReactNode } from 'react'
import type { AgentConnection } from '../../../shared/account'
import { useManorService } from '../../services/ManorServices'

export function AgentConnections(): ReactNode {
  const account = useManorService('account')
  const [connections, setConnections] = useState<readonly AgentConnection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void account.connections().then(rows => { if (active) setConnections(rows) }, failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { active = false }
  }, [account])
  const revoke = async (clientId: string): Promise<void> => {
    setBusy(clientId); setError(null)
    try {
      await account.revokeConnection(clientId)
      setConnections(await account.connections())
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(null) }
  }
  return <section className="set-section">
    <h2 className="set-section-title">Agent connections</h2>
    <p className="set-description">Manage agents you have connected to Manor. Removing access takes effect immediately.</p>
    {error && <p role="alert">{error}</p>}
    {connections === null ? <p role="status">Loading connections…</p> : connections.length === 0 ? <p>No connected agents.</p> :
      connections.map(connection => <div className="set-row" key={connection.clientId}>
        <div><strong>{connection.canWrite ? 'Read and edit access' : 'Read access'}</strong>
          <p>Connected {new Date(connection.authorizedAt).toLocaleDateString()}</p>
          <small>Connection {connection.clientId.slice(0, 8)}</small>
        </div>
        <button type="button" className="ui-button ui-button--subtle" data-testid={`revoke-agent-${connection.clientId}`} disabled={busy !== null} onClick={() => void revoke(connection.clientId)}>{busy === connection.clientId ? 'Removing…' : 'Remove access'}</button>
      </div>)}
  </section>
}
