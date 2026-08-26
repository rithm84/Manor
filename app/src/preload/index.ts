import { contextBridge, ipcRenderer } from 'electron'

import type { AccountApi, SignInMutation } from '../shared/account'
import type { AlfredApi, AlfredRoute } from '../shared/alfred'
import type { CaptureApi } from '../shared/capture'
import type { KbApi } from '../shared/kb'
import type { ResumesApi, ResumeUpload } from '../shared/resumes'
import type { XApi } from '../shared/xConnection'
import type { CalendarApi } from '../shared/calendar'
import type { AlfredCloudApi, AlfredAuditDraft, AlfredConsultQuery } from '../shared/alfredVoice'

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

const accountApi: AccountApi = {
  signIn: (mutation: SignInMutation) => ipcRenderer.invoke('account:sign-in', mutation),
  signUp: (mutation: SignInMutation) => ipcRenderer.invoke('account:sign-up', mutation),
  signOut: () => ipcRenderer.invoke('account:sign-out'),
  current: () => ipcRenderer.invoke('account:current')
}

const captureApi: CaptureApi = {
  captureToKnowledgeBase: () => ipcRenderer.invoke('capture:knowledge-base')
}

const resumesApi: ResumesApi = {
  list: () => ipcRenderer.invoke('resumes:list'),
  upload: (upload: ResumeUpload) => ipcRenderer.invoke('resumes:upload', upload),
  remove: (resumeId: string) => ipcRenderer.invoke('resumes:remove', resumeId)
}

const kbApi: KbApi = {
  list: () => ipcRenderer.invoke('kb:list'),
  remove: (entryId: string) => ipcRenderer.invoke('kb:remove', entryId),
  screenshotUrl: (entryId: string) => ipcRenderer.invoke('kb:screenshot-url', entryId),
  normalize: (entryId: string) => ipcRenderer.invoke('kb:normalize', entryId)
}

const xApi: XApi = {
  beginConnect: () => ipcRenderer.invoke('x:begin-connect'),
  completeConnect: () => ipcRenderer.invoke('x:complete-connect'),
  status: () => ipcRenderer.invoke('x:status'),
  disconnect: () => ipcRenderer.invoke('x:disconnect'),
  ingestNow: () => ipcRenderer.invoke('x:ingest-now')
}

const gcalApi: CalendarApi = {
  beginConnect: () => ipcRenderer.invoke('gcal:begin-connect'),
  completeConnect: () => ipcRenderer.invoke('gcal:complete-connect'),
  accounts: () => ipcRenderer.invoke('gcal:accounts'),
  calendars: () => ipcRenderer.invoke('gcal:calendars'),
  setCalendarEnabled: (calendarId: string, accountId: string, enabled: boolean) =>
    ipcRenderer.invoke('gcal:set-calendar-enabled', calendarId, accountId, enabled),
  disconnect: (accountId: string) => ipcRenderer.invoke('gcal:disconnect', accountId),
  eventsFor: (dates: readonly string[]) => ipcRenderer.invoke('gcal:events-for', dates)
}

const alfredCloudApi: AlfredCloudApi = {
  mintSession: () => ipcRenderer.invoke('alfred:mint-session'),
  consult: (query: AlfredConsultQuery) => ipcRenderer.invoke('alfred:consult', query),
  remember: (fact: string) => ipcRenderer.invoke('alfred:remember', fact),
  sessionSummary: (summary: string) => ipcRenderer.invoke('alfred:session-summary', summary),
  audit: (draft: AlfredAuditDraft) => ipcRenderer.invoke('alfred:audit', draft)
}

contextBridge.exposeInMainWorld('manor', {
  account: accountApi,
  alfred: alfredApi,
  alfredCloud: alfredCloudApi,
  capture: captureApi,
  gcal: gcalApi,
  kb: kbApi,
  resumes: resumesApi,
  x: xApi,
  home: homeApi,
  habits: habitsApi,
  jobs: jobsApi,
  leetcode: leetCodeApi,
  moodFocus: moodFocusApi,
  notes: notesApi
})
