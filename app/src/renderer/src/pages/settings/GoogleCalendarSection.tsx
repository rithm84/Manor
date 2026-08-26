import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { CalendarAccount, GoogleCalendar } from '../../../../shared/calendar'
import { Button, Modal } from '../../components/ui'
import { SettingsRow, SettingsToggle } from './controls'
import { calendarApi, useGoogleConnect } from './useGoogleConnect'

const FALLBACK_DOT = '#6e6975'

/** Connections row for Google Calendar: live connected accounts, their
    calendars with enable toggles, connect and disconnect flows. Read-only
    by design; events feed the Today timeline and nothing writes back. */
export function GoogleCalendarSection(): ReactNode {
  const [accounts, setAccounts] = useState<readonly CalendarAccount[] | null>(null)
  const [calendars, setCalendars] = useState<readonly GoogleCalendar[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<CalendarAccount | null>(null)
  const [disconnectBusy, setDisconnectBusy] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const load = (): void => {
    Promise.resolve()
      .then(() => {
        const api = calendarApi()
        return Promise.all([api.accounts(), api.calendars()])
      })
      .then(([nextAccounts, nextCalendars]) => {
        setAccounts(nextAccounts)
        setCalendars(nextCalendars)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        console.error('Google Calendar accounts failed to load', { error: cause })
        setAccounts([])
        setCalendars([])
        setLoadError('Google Calendar did not load. Check your connection and reopen Settings.')
      })
  }

  const connect = useGoogleConnect(() => load())

  // Mount-only load; the connect and disconnect flows refresh explicitly.
  useEffect(load, [])

  const setEnabled = (calendar: GoogleCalendar, enabled: boolean): void => {
    setCalendars((previous) =>
      previous.map((candidate) =>
        candidate.id === calendar.id && candidate.accountId === calendar.accountId
          ? { ...candidate, enabled }
          : candidate
      )
    )
    calendarApi()
      .setCalendarEnabled(calendar.id, calendar.accountId, enabled)
      .catch((cause: unknown) => {
        console.error('Calendar toggle failed', { error: cause, calendarId: calendar.id })
        setCalendars((previous) =>
          previous.map((candidate) =>
            candidate.id === calendar.id && candidate.accountId === calendar.accountId
              ? { ...candidate, enabled: !enabled }
              : candidate
          )
        )
        setLoadError('That calendar could not be updated. Try again.')
      })
  }

  const confirmDisconnect = (): void => {
    if (disconnecting === null || disconnectBusy) return
    setDisconnectBusy(true)
    setDisconnectError(null)
    calendarApi()
      .disconnect(disconnecting.id)
      .then(() => {
        setDisconnectBusy(false)
        setDisconnecting(null)
        load()
      })
      .catch((cause: unknown) => {
        console.error('Google account disconnect failed', { error: cause, accountId: disconnecting.id })
        setDisconnectBusy(false)
        setDisconnectError('Disconnect did not go through. Try again.')
      })
  }

  const inlineError = connect.error ?? loadError

  return (
    <>
      <SettingsRow
        label="Google Calendar"
        description="Events from these calendars appear in your Today timeline. Manor never changes them."
      >
        <Button variant="ghost" onClick={connect.start} disabled={connect.busy || accounts === null}>
          {connect.busy
            ? 'Connecting…'
            : (accounts?.length ?? 0) === 0
              ? 'Connect account'
              : 'Connect another account'}
        </Button>
      </SettingsRow>
      {inlineError !== null ? (
        <span className="set-cal-error" role="alert">
          {inlineError}
        </span>
      ) : null}
      {(accounts ?? []).map((account) => (
        <div key={account.id} className="set-cal-account">
          <div className="set-cal-account-head">
            <span className="set-cal-account-mail">{account.email}</span>
            <Button variant="subtle" onClick={() => setDisconnecting(account)}>
              Disconnect
            </Button>
          </div>
          <div className="set-cal-list">
            {calendars
              .filter((calendar) => calendar.accountId === account.id)
              .map((calendar) => (
                <div key={calendar.id} className="set-cal-row">
                  <span
                    className="set-cal-dot"
                    style={{ ['--swatch' as string]: calendar.colorId ?? FALLBACK_DOT }}
                    aria-hidden="true"
                  />
                  <span className="set-cal-name">{calendar.name}</span>
                  <SettingsToggle
                    checked={calendar.enabled}
                    onChange={(enabled) => setEnabled(calendar, enabled)}
                    ariaLabel={`Show ${calendar.name} in the Today timeline`}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}

      <Modal
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        width={400}
        ariaLabel="Disconnect Google account"
      >
        <div className="set-dialog">
          <h2 className="set-dialog-title">Disconnect {disconnecting?.email}?</h2>
          <p className="set-dialog-body">
            Its events leave your Today timeline. Nothing changes in Google Calendar.
          </p>
          {disconnectError !== null ? (
            <span className="set-signin-error" role="alert">
              {disconnectError}
            </span>
          ) : null}
          <div className="set-dialog-actions">
            <Button variant="subtle" onClick={() => setDisconnecting(null)} disabled={disconnectBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmDisconnect} disabled={disconnectBusy}>
              {disconnectBusy ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
