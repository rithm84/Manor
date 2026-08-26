import { useState } from 'react'

import type { CalendarAccount, CalendarApi, CalendarBridgeHost } from '../../../../shared/calendar'
import { accountErrorMessage } from '../welcome/accountSession'

/** The gcal bridge the orchestrator wires onto window.manor. */
export function calendarApi(): CalendarApi {
  const bridge = (window.manor as unknown as Partial<CalendarBridgeHost>).gcal
  if (bridge === undefined) {
    throw new Error('Google Calendar is not available in this build yet.')
  }
  return bridge
}

function openInBrowser(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  anchor.click()
}

export interface GoogleConnectState {
  busy: boolean
  error: string | null
  start: () => void
  clearError: () => void
}

/** Runs the Google Calendar OAuth flow: opens the consent page in the
    browser, then waits for the loopback redirect to land. */
export function useGoogleConnect(onConnected: (account: CalendarAccount) => void): GoogleConnectState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    Promise.resolve()
      .then(() => {
        const api = calendarApi()
        return api.beginConnect().then(({ authorizeUrl }) => {
          openInBrowser(authorizeUrl)
          return api.completeConnect()
        })
      })
      .then((account) => {
        setBusy(false)
        onConnected(account)
      })
      .catch((cause: unknown) => {
        console.error('Google Calendar connect failed', { error: cause })
        setBusy(false)
        setError(accountErrorMessage(cause, 'Google Calendar did not finish connecting. Try again.'))
      })
  }

  return { busy, error, start, clearError: () => setError(null) }
}
