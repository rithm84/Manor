import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { XConnectionStatus } from '../../../../shared/xConnection'
import { Button, Modal, Pill } from '../../components/ui'
import { xApiOf } from '../bookmarks/xApi'
import { SettingsRow } from './controls'
import './xConnection.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Short date for the connected-since caption; adds the year when it differs. */
export function connectedSinceLabel(connectedAt: string, now: Date): string {
  const date = new Date(connectedAt)
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`
  return date.getFullYear() === now.getFullYear() ? label : `${label}, ${date.getFullYear()}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openInNewTab(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  anchor.click()
}

/**
 * The X row for Settings → Connections: live connection status, the OAuth
 * connect flow (opens x.com, then waits for the loopback callback), and
 * disconnect with confirmation. Mounted by the settings page.
 */
export function XConnectionSection(): ReactNode {
  const [status, setStatus] = useState<XConnectionStatus | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const api = xApiOf()
    if (api === null) return
    let cancelled = false
    api.status().then(
      (current) => {
        if (!cancelled) setStatus(current)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause))
      }
    )
    return (): void => {
      cancelled = true
    }
  }, [])

  async function connect(): Promise<void> {
    const api = xApiOf()
    if (api === null) {
      setError('X sync is not available in this build.')
      return
    }
    setBusy('connect')
    setError(null)
    try {
      const { authorizeUrl } = await api.beginConnect()
      openInNewTab(authorizeUrl)
      const next = await api.completeConnect()
      setStatus(next)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(): Promise<void> {
    const api = xApiOf()
    if (api === null) {
      setError('X sync is not available in this build.')
      setConfirming(false)
      return
    }
    setBusy('disconnect')
    setError(null)
    try {
      await api.disconnect()
      setStatus({ connected: false, username: null, connectedAt: null })
      setConfirming(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const connected = status !== null && status.connected

  return (
    <>
      <SettingsRow label="X" description="Sync your X bookmarks into Manor.">
        {status === null && error === null ? (
          <span className="setx-ghost" aria-hidden="true" />
        ) : connected ? (
          <div className="setx-connected">
            <Pill variant="tag" colorway="success" label={`@${status.username ?? ''}`} />
            {status.connectedAt !== null ? (
              <span className="setx-since">Since {connectedSinceLabel(status.connectedAt, new Date())}</span>
            ) : null}
            <Button variant="subtle" onClick={() => setConfirming(true)} disabled={busy !== null}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => void connect()} disabled={busy !== null}>
            {busy === 'connect' ? 'Waiting for X…' : 'Connect'}
          </Button>
        )}
      </SettingsRow>
      {busy === 'connect' ? (
        <div className="setx-hint">Finish signing in with the tab that just opened.</div>
      ) : null}
      {error !== null ? (
        <div className="setx-error" role="alert">
          {error}
        </div>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => {
          if (busy === null) setConfirming(false)
        }}
        width={400}
        ariaLabel="Disconnect X"
      >
        <div className="setx-dialog">
          <h2 className="setx-dialog-title">
            Disconnect {status !== null && status.username !== null ? `@${status.username}` : 'X'}?
          </h2>
          <p className="setx-dialog-body">
            New bookmarks stop syncing. Everything already saved stays in your knowledge base.
          </p>
          <div className="setx-dialog-actions">
            <Button variant="subtle" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void disconnect()} disabled={busy !== null}>
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
