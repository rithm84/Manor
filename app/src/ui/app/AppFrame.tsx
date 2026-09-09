import { PanelLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Tooltip } from '../components/ui'
import { PageErrorBoundary } from './PageErrorBoundary'
import { PaperBackdrop } from './PaperBackdrop'
import { Sidebar } from './Sidebar'
import { useSidebarDocked } from './sidebarState'

const FLOAT_DISMISS_MS = 240

/** Docked or floating sidebar and route content. Authentication is owned by the web entry point. */
export function AppFrame(): ReactNode {
  const location = useLocation()
  const [docked, setDocked] = useSidebarDocked()
  const [floatOpen, setFloatOpen] = useState(false)
  const dismissTimer = useRef<number | null>(null)

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
        <header className={`topbar${docked ? '' : ' is-unpinned'}`}>
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
            <PageErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </PageErrorBoundary>
        </main>
      </div>

      <PaperBackdrop />
    </div>
  )
}
