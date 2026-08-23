import { Calendar, PanelLeft, PanelsTopLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Tooltip } from '../components/ui'
import { AlfredModal } from './AlfredModal'
import { Sidebar } from './Sidebar'

const FLOAT_DISMISS_MS = 240
const CALENDAR_PATH = '/calendar'
/** localStorage key for the docked/collapsed choice ('1' docked, '0' collapsed). */
export const SIDEBAR_DOCKED_KEY = 'manor.sidebar.docked'

/**
 * The app shell: sidebar (docked column, or collapsed with an edge-summoned
 * floating overlay), draggable titlebar strip with the workspace/calendar
 * toggle, page outlet, and the Alfred modal on Option+Space.
 *
 * Sidebar model (Notion-like): docked by default; ONE topbar control toggles
 * docked <-> collapsed. While collapsed, hovering the left edge or the toggle
 * reveals the floating overlay (dismisses on mouse-leave); clicking the
 * toggle docks it back. The choice persists across restarts.
 *
 * Calendar is a workspace, not a sidebar tab: on /calendar the module
 * sidebar is hidden and the page renders full-window without frame padding.
 */
export function AppFrame(): ReactNode {
  const location = useLocation()
  const navigate = useNavigate()
  const [docked, setDocked] = useState<boolean>(
    () => window.localStorage.getItem(SIDEBAR_DOCKED_KEY) !== '0'
  )
  const [floatOpen, setFloatOpen] = useState(false)
  const [alfredOpen, setAlfredOpen] = useState(false)
  const dismissTimer = useRef<number | null>(null)
  const lastWorkspacePath = useRef('/home')

  const inCalendar = location.pathname === CALENDAR_PATH

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_DOCKED_KEY, docked ? '1' : '0')
  }, [docked])

  useEffect(() => {
    if (location.pathname !== CALENDAR_PATH) {
      lastWorkspacePath.current = location.pathname
    }
  }, [location.pathname])

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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && event.code === 'Space') {
        event.preventDefault()
        setAlfredOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const onOpenAlfred = (): void => setAlfredOpen(true)
    window.addEventListener('manor:open-alfred', onOpenAlfred)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('manor:open-alfred', onOpenAlfred)
    }
  }, [])

  useEffect(() => {
    return (): void => {
      cancelDismiss()
    }
  }, [cancelDismiss])

  /** The single sidebar control: docked -> collapse; collapsed -> dock. */
  const toggleSidebar = useCallback((): void => {
    cancelDismiss()
    setFloatOpen(false)
    setDocked((current) => !current)
  }, [cancelDismiss])

  const revealFloat = useCallback((): void => {
    cancelDismiss()
    setFloatOpen(true)
  }, [cancelDismiss])

  const showSidebar = !inCalendar

  return (
    <div className="frame">
      {showSidebar && docked ? (
        <aside className="sidebar">
          <Sidebar mode="docked" />
        </aside>
      ) : null}
      {showSidebar && !docked ? (
        <>
          <div className="sidebar-hoverstrip" onMouseEnter={revealFloat} />
          <aside
            className={`sidebar-float${floatOpen ? ' is-open' : ''}`}
            onMouseEnter={cancelDismiss}
            onMouseLeave={scheduleDismiss}
          >
            <Sidebar mode="floating" />
          </aside>
        </>
      ) : null}

      <div className="content">
        <header className={`topbar titlebar-drag${showSidebar && docked ? '' : ' is-unpinned'}`}>
          {showSidebar ? (
            <Tooltip label={docked ? 'Collapse sidebar' : 'Dock sidebar'} side="bottom">
              <button
                type="button"
                className="topbar-btn"
                onClick={toggleSidebar}
                onMouseEnter={docked ? undefined : revealFloat}
                onMouseLeave={docked ? undefined : scheduleDismiss}
                aria-label={docked ? 'Collapse sidebar' : 'Dock sidebar'}
                aria-pressed={docked}
              >
                <PanelLeft size={16} />
              </button>
            </Tooltip>
          ) : null}
          <span className="topbar-spacer" />
          <div className="ws-toggle" role="tablist" aria-label="Workspace or calendar">
            <Tooltip label="Workspace" side="bottom">
              <button
                type="button"
                role="tab"
                aria-selected={!inCalendar}
                className={`ws-toggle-btn${!inCalendar ? ' is-active' : ''}`}
                onClick={() => {
                  if (inCalendar) {
                    void navigate(lastWorkspacePath.current)
                  }
                }}
                aria-label="Workspace"
              >
                <PanelsTopLeft size={15} />
              </button>
            </Tooltip>
            <Tooltip label="Calendar" side="bottom">
              <button
                type="button"
                role="tab"
                aria-selected={inCalendar}
                className={`ws-toggle-btn${inCalendar ? ' is-active' : ''}`}
                onClick={() => {
                  if (!inCalendar) {
                    void navigate(CALENDAR_PATH)
                  }
                }}
                aria-label="Calendar"
              >
                <Calendar size={15} />
              </button>
            </Tooltip>
          </div>
        </header>
        <main className={`page${inCalendar ? ' page--bare' : ''}`}>
          <Outlet />
        </main>
      </div>

      <AlfredModal open={alfredOpen} onClose={() => setAlfredOpen(false)} />
    </div>
  )
}
