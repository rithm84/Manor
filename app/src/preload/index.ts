import { contextBridge, ipcRenderer } from 'electron'

import type {
  ContextDraft,
  HomeApi,
  HomeSeed,
  SavedTaskView,
  ScratchBlock,
  Task
} from '../shared/home'
import type {
  HabitDraft,
  HabitLogMutation,
  HabitsApi,
  HabitSeed,
  HabitStatusMutation
} from '../shared/habits'
import type {
  FocusMutation,
  MoodFocusApi,
  MoodFocusNoteMutation,
  MoodFocusSeed,
  MoodMutation
} from '../shared/moodFocus'
import type {
  JobRoleFields,
  JobRoleUpdate,
  JobsApi,
  JobsSeed,
  JobStageMutation
} from '../shared/jobs'
import type {
  AddLeetCodeAttemptMutation,
  LeetCodeApi,
  LeetCodeSeed,
  UpdateLeetCodeAttemptMutation
} from '../shared/leetcode'

const homeApi: HomeApi = {
  load: (seed: HomeSeed) => ipcRenderer.invoke('home:load', seed),
  upsertTask: (task: Task) => ipcRenderer.invoke('home:upsert-task', task),
  deleteTask: (taskId: string) => ipcRenderer.invoke('home:delete-task', taskId),
  addContext: (context: ContextDraft) => ipcRenderer.invoke('home:add-context', context),
  upsertScratchBlock: (block: ScratchBlock) =>
    ipcRenderer.invoke('home:upsert-scratch-block', block),
  deleteScratchBlock: (blockId: string) =>
    ipcRenderer.invoke('home:delete-scratch-block', blockId),
  upsertSavedTaskView: (view: SavedTaskView) =>
    ipcRenderer.invoke('home:upsert-saved-task-view', view),
  deleteSavedTaskView: (viewId: string) =>
    ipcRenderer.invoke('home:delete-saved-task-view', viewId)
}

const habitsApi: HabitsApi = {
  load: (seed: HabitSeed) => ipcRenderer.invoke('habits:load', seed),
  createHabit: (draft: HabitDraft) => ipcRenderer.invoke('habits:create', draft),
  updateHabit: (habitId: string, draft: HabitDraft) =>
    ipcRenderer.invoke('habits:update', habitId, draft),
  setEntry: (mutation: HabitLogMutation) => ipcRenderer.invoke('habits:set-entry', mutation),
  setStatus: (mutation: HabitStatusMutation) => ipcRenderer.invoke('habits:set-status', mutation),
  deleteHabit: (habitId: string) => ipcRenderer.invoke('habits:delete', habitId)
}

const moodFocusApi: MoodFocusApi = {
  load: (seed: MoodFocusSeed) => ipcRenderer.invoke('mood-focus:load', seed),
  setMood: (mutation: MoodMutation) => ipcRenderer.invoke('mood-focus:set-mood', mutation),
  setFocus: (mutation: FocusMutation) => ipcRenderer.invoke('mood-focus:set-focus', mutation),
  setNote: (mutation: MoodFocusNoteMutation) =>
    ipcRenderer.invoke('mood-focus:set-note', mutation)
}

const jobsApi: JobsApi = {
  load: (seed: JobsSeed) => ipcRenderer.invoke('jobs:load', seed),
  createRole: (fields: JobRoleFields) => ipcRenderer.invoke('jobs:create-role', fields),
  updateRole: (mutation: JobRoleUpdate) => ipcRenderer.invoke('jobs:update-role', mutation),
  setStage: (mutation: JobStageMutation) => ipcRenderer.invoke('jobs:set-stage', mutation),
  deleteRole: (roleId: string) => ipcRenderer.invoke('jobs:delete-role', roleId)
}

const leetCodeApi: LeetCodeApi = {
  load: (seed: LeetCodeSeed) => ipcRenderer.invoke('leetcode:load', seed),
  addAttempt: (mutation: AddLeetCodeAttemptMutation) =>
    ipcRenderer.invoke('leetcode:add-attempt', mutation),
  updateAttempt: (mutation: UpdateLeetCodeAttemptMutation) =>
    ipcRenderer.invoke('leetcode:update-attempt', mutation),
  deleteAttempt: (attemptId: string) => ipcRenderer.invoke('leetcode:delete-attempt', attemptId)
}

contextBridge.exposeInMainWorld('manor', {
  home: homeApi,
  habits: habitsApi,
  jobs: jobsApi,
  leetcode: leetCodeApi,
  moodFocus: moodFocusApi
})
