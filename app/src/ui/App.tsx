import { Tooltip } from '@base-ui/react/tooltip'
import { ManorServicesProvider } from './services/ManorServices'
import type { ManorServices } from './services/ManorServices'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'

import { AppFrame } from './app/AppFrame'
import { routeLoaders } from './routes'
const BookmarksPage = lazy(routeLoaders['/bookmarks'])
const HabitsPage = lazy(routeLoaders['/habits'])
const HomePage = lazy(routeLoaders['/home'])
const JobsPage = lazy(routeLoaders['/jobs'])
const LeetCodePage = lazy(routeLoaders['/leetcode'])
const MoodFocusPage = lazy(routeLoaders['/mood-focus'])
const NotesPage = lazy(routeLoaders['/notes'])
import { SecondaryModuleSurface } from './pages/SecondaryModuleSurface'
const WeeklyReviewsPage = lazy(routeLoaders['/weekly-reviews'])
const SettingsPage = lazy(routeLoaders['/settings'])

export function App({ services }: { services: ManorServices }): ReactNode {
  return (
    <ManorServicesProvider services={services}>
    <Tooltip.Provider delay={400} timeout={500}><BrowserRouter>
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
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes></Suspense>
    </BrowserRouter></Tooltip.Provider>
    </ManorServicesProvider>
  )
}
