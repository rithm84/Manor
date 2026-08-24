import { contextBridge, ipcRenderer } from 'electron'

import type { AlfredApi, AlfredRoute } from '../shared/alfred'
import type {
  CalendarApi,
  CalendarDefinition,
  CalendarEventRecord,
  CalendarOccurrenceMutation,
  CalendarSeed,
  CalendarSettings
} from '../shared/calendar'

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
import type {
  NoteAttachmentUpload,
  NoteFolderDraft,
  NoteFolderRename,
  NotePageContentUpdate,
  NotePageDraft,
  NotePageFavoriteMutation,
  NotePageMove,
  NotesApi,
  NotesSeed
} from '../shared/notes'
import { parseNotePage } from '../shared/notes'

function noteFlushResponse(value: unknown): ReturnType<typeof parseNotePage> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('notes flush response must be an object')
  }
  const response = value as Record<string, unknown>
  if (response.ok === true) return parseNotePage(response.page)
  if (response.ok === false && typeof response.error === 'string') {
    throw new Error(response.error)
  }
  throw new TypeError('notes flush response must contain a result or error')
}

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

const calendarApi: CalendarApi = {
  load: (seed: CalendarSeed) => ipcRenderer.invoke('calendar:load', seed),
  upsertCalendar: (calendar: CalendarDefinition) =>
    ipcRenderer.invoke('calendar:upsert-calendar', calendar),
  deleteCalendar: (calendarId: string) =>
    ipcRenderer.invoke('calendar:delete-calendar', calendarId),
  upsertEvent: (event: CalendarEventRecord) =>
    ipcRenderer.invoke('calendar:upsert-event', event),
  replaceOccurrence: (mutation: CalendarOccurrenceMutation) =>
    ipcRenderer.invoke('calendar:replace-occurrence', mutation),
  deleteEvent: (eventId: string) => ipcRenderer.invoke('calendar:delete-event', eventId),
  updateSettings: (settings: CalendarSettings) =>
    ipcRenderer.invoke('calendar:update-settings', settings)
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

const notesApi: NotesApi = {
  load: (seed: NotesSeed) => ipcRenderer.invoke('notes:load', seed),
  createFolder: (draft: NoteFolderDraft) => ipcRenderer.invoke('notes:create-folder', draft),
  renameFolder: (mutation: NoteFolderRename) =>
    ipcRenderer.invoke('notes:rename-folder', mutation),
  deleteFolder: (folderId: string) => ipcRenderer.invoke('notes:delete-folder', folderId),
  createPage: (draft: NotePageDraft) => ipcRenderer.invoke('notes:create-page', draft),
  updatePage: (mutation: NotePageContentUpdate) =>
    ipcRenderer.invoke('notes:update-page', mutation),
  flushPage: (mutation: NotePageContentUpdate) =>
    noteFlushResponse(ipcRenderer.sendSync('notes:flush-page', mutation)),
  touchPage: (pageId: string) => ipcRenderer.invoke('notes:touch-page', pageId),
  movePage: (mutation: NotePageMove) => ipcRenderer.invoke('notes:move-page', mutation),
  duplicatePage: (pageId: string) => ipcRenderer.invoke('notes:duplicate-page', pageId),
  setFavorite: (mutation: NotePageFavoriteMutation) =>
    ipcRenderer.invoke('notes:set-favorite', mutation),
  archivePage: (pageId: string) => ipcRenderer.invoke('notes:archive-page', pageId),
  trashPage: (pageId: string) => ipcRenderer.invoke('notes:trash-page', pageId),
  restorePage: (pageId: string) => ipcRenderer.invoke('notes:restore-page', pageId),
  permanentlyDeletePage: (pageId: string) =>
    ipcRenderer.invoke('notes:permanently-delete-page', pageId),
  uploadAttachment: (upload: NoteAttachmentUpload) =>
    ipcRenderer.invoke('notes:upload-attachment', upload),
  resolveAttachment: (attachmentId: string) =>
    ipcRenderer.invoke('notes:resolve-attachment', attachmentId)
}

const alfredApi: AlfredApi = {
  getShortcutStatus: () => ipcRenderer.invoke('alfred:get-shortcut-status'),
  requestMicrophonePermission: () => ipcRenderer.invoke('alfred:request-microphone-permission'),
  dismissPanel: () => ipcRenderer.invoke('alfred:dismiss-panel'),
  navigate: (route: AlfredRoute) => ipcRenderer.invoke('alfred:navigate', route),
  onModalToggle: (listener: () => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('alfred:toggle-modal', wrapped)
    return () => ipcRenderer.removeListener('alfred:toggle-modal', wrapped)
  },
  onPanelVisibility: (listener: (visible: boolean) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, visible: boolean): void => listener(visible)
    ipcRenderer.on('alfred:panel-visibility', wrapped)
    return () => ipcRenderer.removeListener('alfred:panel-visibility', wrapped)
  },
  onNavigate: (listener: (route: AlfredRoute) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, route: AlfredRoute): void => listener(route)
    ipcRenderer.on('alfred:navigate', wrapped)
    return () => ipcRenderer.removeListener('alfred:navigate', wrapped)
  }
}

contextBridge.exposeInMainWorld('manor', {
  alfred: alfredApi,
  calendar: calendarApi,
  home: homeApi,
  habits: habitsApi,
  jobs: jobsApi,
  leetcode: leetCodeApi,
  moodFocus: moodFocusApi,
  notes: notesApi
})
