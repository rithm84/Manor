import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'

import { AppFrame } from './app/AppFrame'
import { AlfredPanelPage } from './alfred/AlfredPanelPage'
import { AlfredActivityPage } from './pages/AlfredActivityPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { HabitsPage } from './pages/HabitsPage'
import { HomePage } from './pages/HomePage'
import { JobsPage } from './pages/JobsPage'
import { JournalPage } from './pages/JournalPage'
import { LeetCodePage } from './pages/LeetCodePage'
import { MoodFocusPage } from './pages/MoodFocusPage'
import { NotesPage } from './pages/NotesPage'
import { SecondaryModuleSurface } from './pages/SecondaryModuleSurface'
import { SettingsPage } from './pages/SettingsPage'
import { WelcomePage } from './pages/WelcomePage'

export function App(): ReactNode {
  return (
    <HashRouter>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/alfred-panel" element={<AlfredPanelPage />} />
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
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/alfred-activity" element={<AlfredActivityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </HashRouter>
  )
}
