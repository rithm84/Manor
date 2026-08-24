/// <reference types="vite/client" />

import type { HomeApi } from './shared/home'
import type { AlfredApi } from './shared/alfred'
import type { CalendarApi } from './shared/calendar'
import type { HabitsApi } from './shared/habits'
import type { JobsApi } from './shared/jobs'
import type { LeetCodeApi } from './shared/leetcode'
import type { MoodFocusApi } from './shared/moodFocus'
import type { NotesApi } from './shared/notes'

declare global {
  interface Window {
    manor: {
      alfred: AlfredApi
      calendar: CalendarApi
      home: HomeApi
      habits: HabitsApi
      jobs: JobsApi
      leetcode: LeetCodeApi
      moodFocus: MoodFocusApi
      notes: NotesApi
    }
  }
}

export {}
