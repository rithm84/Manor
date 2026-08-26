import { PanelLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import type { AlfredRoute } from '../../../shared/alfred'
import { Tooltip } from '../components/ui'
import { AlfredModal } from './AlfredModal'
import { PaperBackdrop } from './PaperBackdrop'
import { Sidebar } from './Sidebar'
import { useSidebarDocked } from './sidebarState'

const FLOAT_DISMISS_MS = 240

/**
 * The app shell: sidebar (docked column, or collapsed with an edge-summoned
 * floating overlay), draggable titlebar strip, page outlet, and the Alfred
 * modal on Option+M.
 *
 * Sidebar model (Notion-like): docked by default; ONE topbar control toggles
 * docked <-> collapsed. While collapsed, hovering the left edge or the toggle
 * reveals the floating overlay (dismisses on mouse-leave; keyboard focus on
 * the toggle or inside the float also holds it open); clicking the toggle
 * docks it back. The choice persists across restarts (see sidebarState).
 */
export function AppFrame(): ReactNode {
  const navigate = useNavigate()
  const [docked, setDocked] = useSidebarDocked()
  const [floatOpen, setFloatOpen] = useState(false)
  const [alfredOpen, setAlfredOpen] = useState(false)
  const dismissTimer = useRef<number | null>(null)

  // First run routes into onboarding: no completed welcome on this machine
  // and no signed-in session. An existing session marks the machine welcomed.
  useEffect(() => {
    if (window.localStorage.getItem('manor.welcomed') === '1') return
    let cancelled = false
    void window.manor.account
      .current()
      .then((account) => {
        if (cancelled) return
        if (account === null) {
          void navigate('/welcome')
        } else {
          window.localStorage.setItem('manor.welcomed', '1')
        }
      })
      .catch((error: unknown) => {
        console.error('First run session check failed', { error })
      })
    return (): void => {
      cancelled = true
    }
    // navigate is stable; run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancelDismiss = useCallback((): void => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
  }, [])

  const scheduleDismiss = useCallback((): void => {
    cancelDismiss()
    dismissTimer.current = window.setTimeout(() => {
      setFloatOpen(false)
      dismissTimer.current = null
    }, FLOAT_DISMISS_MS)
  }, [cancelDismiss])

  useEffect(() => {
    const onOpenAlfred = (): void => setAlfredOpen(true)
    window.addEventListener('manor:open-alfred', onOpenAlfred)
    const unsubscribeToggle = window.manor.alfred.onModalToggle(() => {
      setAlfredOpen((current) => !current)
    })
    const unsubscribeNavigate = window.manor.alfred.onNavigate((route) => {
      setAlfredOpen(false)
      void navigate(route)
    })
    return (): void => {
      window.removeEventListener('manor:open-alfred', onOpenAlfred)
      unsubscribeToggle()
      unsubscribeNavigate()
    }
  }, [navigate])

  useEffect(() => {
    return (): void => {
      cancelDismiss()
    }
  }, [cancelDismiss])

  /** Any docked change (toggle or Settings) retracts the float. */
  useEffect(() => {
    cancelDismiss()
    setFloatOpen(false)
  }, [docked, cancelDismiss])

  /** The single sidebar control: docked -> collapse; collapsed -> dock. */
  const toggleSidebar = useCallback((): void => {
    cancelDismiss()
    setFloatOpen(false)
    setDocked(!docked)
  }, [cancelDismiss, docked, setDocked])

  const revealFloat = useCallback((): void => {
    cancelDismiss()
    setFloatOpen(true)
  }, [cancelDismiss])

  return (
    <div className="frame">
      {docked ? (
        <aside className="sidebar">
          <Sidebar mode="docked" />
        </aside>
      ) : (
        <>
          <div className="sidebar-hoverstrip" onMouseEnter={revealFloat} />
          <aside
            className={`sidebar-float${floatOpen ? ' is-open' : ''}`}
            inert={!floatOpen}
            onMouseEnter={cancelDismiss}
            onMouseLeave={scheduleDismiss}
            onFocus={cancelDismiss}
            onBlur={scheduleDismiss}
          >
            <Sidebar mode="floating" />
          </aside>
        </>
      )}

      <div className="content">
        <header className={`topbar titlebar-drag${docked ? '' : ' is-unpinned'}`}>
          <Tooltip label={docked ? 'Collapse sidebar' : 'Dock sidebar'} side="bottom">
            <button
              type="button"
              className="topbar-btn"
              onClick={toggleSidebar}
              onMouseEnter={docked ? undefined : revealFloat}
              onMouseLeave={docked ? undefined : scheduleDismiss}
              onFocus={docked ? undefined : revealFloat}
              onBlur={docked ? undefined : scheduleDismiss}
              aria-label={docked ? 'Collapse sidebar' : 'Dock sidebar'}
              aria-pressed={docked}
            >
              <PanelLeft size={16} />
            </button>
          </Tooltip>
          <span className="topbar-spacer" />
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>

      <PaperBackdrop />
      <AlfredModal
        open={alfredOpen}
        onClose={() => setAlfredOpen(false)}
        onNavigate={(route: AlfredRoute) => {
          setAlfredOpen(false)
          void navigate(route)
        }}
      />
    </div>
  )
}
