import { Activity, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Routes, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { PageErrorBoundary } from './PageErrorBoundary'
import { PortalContainerContext } from '../components/ui/PortalContainer'

function ModuleSurface({ location, children }: { location: Location; children: ReactNode }): ReactNode {
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  return <>
    <div className="module-portals" ref={element => { if (element !== null) setPortal(element) }} />
    {portal === null ? null : <PortalContainerContext value={portal}>
      <main className="page" data-module-page={location.pathname}>
        <PageErrorBoundary resetKey={location.key}>
          <Suspense fallback={<div role="status" className="web-status">Opening page…</div>}>
            <Routes location={location}>{children}</Routes>
          </Suspense>
        </PageErrorBoundary>
      </main>
    </PortalContainerContext>}
  </>
}

/** Visited modules keep their own view and scroll state for this signed-in session; hidden effects disconnect. */
export function ModulePageCache({ paths, children }: { paths: readonly string[]; children: ReactNode }): ReactNode {
  const location = useLocation()
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  const activePath = paths.includes(pathname) ? pathname : null
  const [visited, setVisited] = useState<ReadonlyMap<string, Location>>(() => new Map())
  const pages = activePath === null || visited.get(activePath) === location
    ? visited
    : new Map([...visited, [activePath, location]])
  if (pages !== visited) setVisited(pages)

  return <>
    {activePath === null ? <Navigate to="/home" replace /> : null}
    {[...pages].map(([path, savedLocation]) => <Activity key={path} mode={path === activePath ? 'visible' : 'hidden'}>
      <ModuleSurface location={savedLocation}>{children}</ModuleSurface>
    </Activity>)}
  </>
}
