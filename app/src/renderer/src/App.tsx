import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'

import { AppFrame } from './app/AppFrame'
import { AlfredActivityPage } from './pages/AlfredActivityPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { CalendarPage } from './pages/CalendarPage'
import { FitnessPage } from './pages/FitnessPage'
import { HabitsPage } from './pages/HabitsPage'
import { HomePage } from './pages/HomePage'
import { JobsPage } from './pages/JobsPage'
import { JournalPage } from './pages/JournalPage'
import { LeetCodePage } from './pages/LeetCodePage'
import { MoodFocusPage } from './pages/MoodFocusPage'
import { NotesPage } from './pages/NotesPage'
import { SettingsPage } from './pages/SettingsPage'
import { WelcomePage } from './pages/WelcomePage'

export function App(): ReactNode {
  return (
    <HashRouter>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route element={<AppFrame />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/habits" element={<HabitsPage />} />
          <Route path="/fitness" element={<FitnessPage />} />
          <Route path="/mood-focus" element={<MoodFocusPage />} />
          <Route path="/leetcode" element={<LeetCodePage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/bookmarks" element={<BookmarksPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/alfred-activity" element={<AlfredActivityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </HashRouter>
  )
}
