import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './appUpdate.css'

const UPDATE_CHECK_INTERVAL_MS = 60_000
const UPDATE_CHECK_ERROR = 'Could not check for updates. Reload when you are online.'

function updateBlockReason(): string | null {
  if (document.querySelector('[role="dialog"]') !== null) return 'Finish or close your open form before updating.'
  if (!window.dispatchEvent(new Event('manor:before-update', { cancelable: true }))) {
    return 'Your latest edits are still being protected. Try again after they save.'
  }
  return null
}

/** Activating a release never reloads another tab or interrupts an open form. */
export function AppUpdateNotice(): ReactNode {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [activated, setActivated] = useState(false)
  const reloadRequested = useRef(false)
  const releaseActivated = useRef(false)
  const onActivated = useCallback((): void => {
    releaseActivated.current = true
    setActivated(true)
    setApplying(false)
    if (reloadRequested.current) {
      reloadRequested.current = false
      const blocked = updateBlockReason()
      if (blocked !== null) {
        setError(blocked)
        return
      }
      window.location.reload()
    }
  }, [])
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, next) => {
      if (next !== undefined) setRegistration(next)
    },
    onRegisterError: (cause: Error) => {
      console.error('App update registration failed', { cause })
      setError(UPDATE_CHECK_ERROR)
    },
    onNeedReload: onActivated
  })

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let previous = navigator.serviceWorker.controller
    const onControllerChange = (): void => {
      const next = navigator.serviceWorker.controller
      // Workbox may classify an update discovered by another tab as external.
      if (previous !== null && next !== null && previous !== next) onActivated()
      previous = next
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [onActivated])

  useEffect(() => {
    if (registration === null) return
    let active = true
    let checking = false
    const check = (): void => {
      if (checking || !navigator.onLine || document.visibilityState !== 'visible' || registration.installing !== null) return
      checking = true
      void registration.update().then(() => {
        if (active) setError((current) => current === UPDATE_CHECK_ERROR ? null : current)
      }).catch((cause: Error) => {
        console.error('App update check failed', { cause })
        if (active) setError(UPDATE_CHECK_ERROR)
      }).finally(() => { checking = false })
    }
    check()
    const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [registration])

  const applyUpdate = (): void => {
    const blocked = updateBlockReason()
    if (blocked !== null) {
      setError(blocked)
      return
    }
    setError(null)
    if ((releaseActivated.current && registration?.waiting === null) || !needRefresh) {
      window.location.reload()
      return
    }
    reloadRequested.current = true
    setApplying(true)
    void updateServiceWorker().catch((cause: Error) => {
      reloadRequested.current = false
      setApplying(false)
      console.error('App update activation failed', { cause })
      setError('Could not apply the update. Try again when you are online.')
    })
  }

  if (!needRefresh && !activated && error === null) return null
  return (
    <aside className="app-update-notice" role="status" data-testid="app-update-notice">
      <div className="app-update-copy">
        <strong>{needRefresh || activated ? 'Update available' : 'Update check interrupted'}</strong>
        {error !== null ? <p role="alert">{error}</p> : <p>Reload to use the latest Manor.</p>}
      </div>
      <button type="button" className="ui-button ui-button--primary" data-testid="app-update-reload" disabled={applying} onClick={applyUpdate}>
        <RefreshCw size={14} />
        {applying ? 'Updating…' : 'Reload'}
      </button>
    </aside>
  )
}
