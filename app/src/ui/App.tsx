import { Tooltip } from '@base-ui/react/tooltip'
import { ManorServicesProvider } from './services/ManorServices'
import type { ManorServices } from './services/ManorServices'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'

import { AppFrame } from './app/AppFrame'
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then(module => ({ default: module.BookmarksPage })))
const HabitsPage = lazy(() => import('./pages/HabitsPage').then(module => ({ default: module.HabitsPage })))
const HomePage = lazy(() => import('./pages/HomePage').then(module => ({ default: module.HomePage })))
const JobsPage = lazy(() => import('./pages/JobsPage').then(module => ({ default: module.JobsPage })))
const LeetCodePage = lazy(() => import('./pages/LeetCodePage').then(module => ({ default: module.LeetCodePage })))
const MoodFocusPage = lazy(() => import('./pages/MoodFocusPage').then(module => ({ default: module.MoodFocusPage })))
const NotesPage = lazy(() => import('./pages/NotesPage').then(module => ({ default: module.NotesPage })))
import { SecondaryModuleSurface } from './pages/SecondaryModuleSurface'
const WeeklyReviewsPage = lazy(() => import('./pages/WeeklyReviewsPage').then(module => ({ default: module.WeeklyReviewsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })))

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
