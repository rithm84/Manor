/// <reference types="vite/client" />

import type { AccountApi } from './shared/account'
import type { CaptureApi } from './shared/capture'
import type { KbApi } from './shared/kb'
import type { ResumesApi } from './shared/resumes'
import type { XApi } from './shared/xConnection'
import type { CalendarApi } from './shared/calendar'
import type { AlfredCloudApi } from './shared/alfredVoice'
import type { HomeApi } from './shared/home'
import type { AlfredApi } from './shared/alfred'
import type { HabitsApi } from './shared/habits'
import type { JobsApi } from './shared/jobs'
import type { LeetCodeApi } from './shared/leetcode'
import type { MoodFocusApi } from './shared/moodFocus'
import type { NotesApi } from './shared/notes'

declare global {
  interface Window {
    manor: {
      account: AccountApi
      alfred: AlfredApi
      alfredCloud: AlfredCloudApi
      capture: CaptureApi
      gcal: CalendarApi
      kb: KbApi
      resumes: ResumesApi
      x: XApi
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
