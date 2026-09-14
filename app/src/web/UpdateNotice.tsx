import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import type { Update } from '@tauri-apps/plugin-updater'
import './updateNotice.css'

/** How often Manor asks the release feed for a newer build, and how stale a check must be for a window focus to repeat it. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Names what stops a restart right now, or null when Manor may restart. */
function restartBlockReason(): string | null {
  if (document.querySelector('[role="dialog"]') !== null) return 'Finish or close your open form before updating.'
  if (!window.dispatchEvent(new Event('manor:before-update', { cancelable: true }))) {
    return 'Your latest edits are still being protected. Try again after they save.'
  }
  return null
}

/**
 * Offers the release that the update feed is holding.
 *
 * Manor checks on mount, every hour, whenever the window regains focus after an
 * idle hour, and when the machine comes back online. A check that fails is logged
 * and repeated on that schedule, never shown: nothing in it needs the person.
 * Once a release is in hand the checks stop, so the version the notice names
 * stays the version a restart installs. Installing replaces the bundle on disk and only a relaunch runs it,
 * which is why the button restarts rather than reloads.
 */
export function UpdateNotice(): ReactNode {
  const [update, setUpdate] = useState<Update | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (update !== null) return
    let active = true
    let checking = false
    let checkedAt = 0
    const runCheck = (): void => {
      // An offline machine cannot reach GitHub, and saying so would be noise rather than news.
      if (checking || !navigator.onLine) return
      checking = true
      checkedAt = Date.now()
      void check().then((found) => {
        if (active && found !== null) setUpdate(found)
      }).catch((cause: unknown) => {
        console.error('Manor could not check for updates', { cause })
      }).finally(() => { checking = false })
    }
    const recheckWhenStale = (): void => {
      if (Date.now() - checkedAt >= CHECK_INTERVAL_MS) runCheck()
    }
    runCheck()
    const timer = window.setInterval(runCheck, CHECK_INTERVAL_MS)
    window.addEventListener('focus', recheckWhenStale)
    window.addEventListener('online', runCheck)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', recheckWhenStale)
      window.removeEventListener('online', runCheck)
    }
  }, [update])

  /** Downloads and installs the release, then relaunches into it. */
  const restartInto = (ready: Update): void => {
    const blocked = restartBlockReason()
    if (blocked !== null) {
      setError(blocked)
      return
    }
    setError(null)
    setInstalling(true)
    void ready.downloadAndInstall().then(() => relaunch()).catch((cause: unknown) => {
      console.error('Manor could not install the update', { cause })
      setInstalling(false)
      setError(`Could not install version ${ready.version}. Check your network connection, then try again.`)
    })
  }

  if (update === null) return null
  return (
    <aside className="app-update-notice" role="status" data-testid="app-update-notice">
      <div className="app-update-copy">
        <strong>Update available</strong>
        {error !== null ? <p role="alert">{error}</p> : <p>Version {update.version} is ready to install.</p>}
      </div>
      <button type="button" className="ui-button ui-button--primary" data-testid="app-update-restart" disabled={installing} onClick={() => restartInto(update)}>
        <RefreshCw size={14} />
        {installing ? 'Updating…' : 'Restart to update'}
      </button>
      {error !== null ? (
        <button type="button" className="app-update-dismiss" aria-label="Dismiss" onClick={() => setError(null)}><X size={14} /></button>
      ) : null}
    </aside>
  )
}
