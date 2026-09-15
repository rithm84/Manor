import { Tooltip } from '@base-ui/react/tooltip'
import { ManorServicesProvider } from './services/ManorServices'
import type { ManorServices } from './services/ManorServices'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'

import { DeepLinkNavigation, useLaunchRoute, type RouteRequest } from '../web/shell/DeepLinkNavigation'
import type { DesktopShell } from '../web/shell/DesktopShell'
import { RouteTiming } from '../web/shell/RouteTiming'
import { ShellProvider } from '../web/shell/ShellContext'

import { AgentConsentPage } from './pages/AgentConsentPage'
import { AppFrame } from './app/AppFrame'
import { routeLoaders } from './routes'
const BookmarksPage = lazy(routeLoaders['/bookmarks'])
const HabitsPage = lazy(routeLoaders['/habits'])
const HomePage = lazy(routeLoaders['/home'])
const JobsPage = lazy(routeLoaders['/jobs'])
const LeetCodePage = lazy(routeLoaders['/leetcode'])
const MoodFocusPage = lazy(routeLoaders['/mood-focus'])
const PomodoroPage = lazy(routeLoaders['/pomodoro'])
const NotesPage = lazy(routeLoaders['/notes'])
import { SecondaryModuleSurface } from './pages/SecondaryModuleSurface'
const WeeklyReviewsPage = lazy(routeLoaders['/weekly-reviews'])
const SettingsPage = lazy(routeLoaders['/settings'])

export function App({ services, shell, routeRequest, onRouteApplied }: { services: ManorServices; shell: DesktopShell; routeRequest: RouteRequest | null; onRouteApplied: () => void }): ReactNode {
  const pendingRoute = useLaunchRoute(routeRequest, onRouteApplied)
  return (
    <ManorServicesProvider services={services}>
    <ShellProvider shell={shell}>
    <Tooltip.Provider delay={400} timeout={500}><BrowserRouter>
      <DeepLinkNavigation request={pendingRoute} onApplied={onRouteApplied} />
      <RouteTiming />
      <Suspense fallback={<div role="status" className="web-status">Opening page…</div>}><Routes>
        <Route element={<AppFrame />}>
          <Route path="/home" element={<HomePage />} />
          <Route
            path="/habits"
            element={
              <SecondaryModuleSurface width="wide">
                <HabitsPage />
              </SecondaryModuleSurface>
            }
          />
          <Route
            path="/mood-focus"
            element={
              <SecondaryModuleSurface width="wide">
                <MoodFocusPage />
              </SecondaryModuleSurface>
            }
          />
          <Route
            path="/pomodoro"
            element={
              <SecondaryModuleSurface width="wide">
                <PomodoroPage />
              </SecondaryModuleSurface>
            }
          />
          <Route
            path="/leetcode"
            element={
              <SecondaryModuleSurface width="wide">
                <LeetCodePage />
              </SecondaryModuleSurface>
            }
          />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route
            path="/bookmarks"
            element={
              <SecondaryModuleSurface width="wide">
                <BookmarksPage />
              </SecondaryModuleSurface>
            }
          />
          <Route path="/weekly-reviews" element={<SecondaryModuleSurface width="wide"><WeeklyReviewsPage /></SecondaryModuleSurface>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/oauth/consent" element={<AgentConsentPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes></Suspense>
    </BrowserRouter></Tooltip.Provider>
    </ShellProvider>
    </ManorServicesProvider>
  )
}
