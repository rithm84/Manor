/// <reference types="vite/client" />

import type { HomeApi } from './shared/home'
import type { HabitsApi } from './shared/habits'
import type { JobsApi } from './shared/jobs'
import type { LeetCodeApi } from './shared/leetcode'
import type { MoodFocusApi } from './shared/moodFocus'

declare global {
  interface Window {
    manor: {
      home: HomeApi
      habits: HabitsApi
      jobs: JobsApi
      leetcode: LeetCodeApi
      moodFocus: MoodFocusApi
    }
  }
}

export {}
