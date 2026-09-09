import { ManorServicesProvider } from './services/ManorServices'
import type { ManorServices } from './services/ManorServices'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'

import { AppFrame } from './app/AppFrame'
import { BookmarksPage } from './pages/BookmarksPage'
import { HabitsPage } from './pages/HabitsPage'
import { HomePage } from './pages/HomePage'
import { JobsPage } from './pages/JobsPage'
import { LeetCodePage } from './pages/LeetCodePage'
import { MoodFocusPage } from './pages/MoodFocusPage'
import { NotesPage } from './pages/NotesPage'
import { SecondaryModuleSurface } from './pages/SecondaryModuleSurface'
import { SettingsPage } from './pages/SettingsPage'

export function App({ services }: { services: ManorServices }): ReactNode {
  return (
    <ManorServicesProvider services={services}>
    <BrowserRouter>
      <Routes>
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
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
    </ManorServicesProvider>
  )
}
