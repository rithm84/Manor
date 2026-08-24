import { ALFRED_ACCELERATOR } from '../../../shared/alfred'
import type { AlfredApi, AlfredMicrophonePermission } from '../../../shared/alfred'
import { BROWSER_BRIDGE_ENDPOINT } from '../../../shared/devBridge'
import type { HabitsApi, HabitsState } from '../../../shared/habits'
import type {
  ContextDefinition,
  HomeApi,
  HomeState,
  SavedTaskView,
  ScratchBlock,
  Task
} from '../../../shared/home'
import type { JobsApi, JobsState } from '../../../shared/jobs'
import type { LeetCodeApi, LeetCodeState } from '../../../shared/leetcode'
import type { MoodFocusApi, MoodFocusState } from '../../../shared/moodFocus'
import { parseNotePage } from '../../../shared/notes'
import type { NoteAttachment, NotePage, NotesApi, NotesState } from '../../../shared/notes'

function unwrapPayload(channel: string, status: number, payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) {
    throw new TypeError(
      `Manor dev bridge returned a non-object payload: channel=${channel} status=${status}`
    )
  }
  const body = payload as Record<string, unknown>
  if (status !== 200) {
    const error = typeof body['error'] === 'string' ? body['error'] : 'unknown error'
    throw new Error(`Manor dev bridge call failed: channel=${channel} status=${status} ${error}`)
  }
  return body['result']
}

async function invoke<T>(channel: string, args: readonly unknown[]): Promise<T> {
  const response = await fetch(BROWSER_BRIDGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args })
  })
  return unwrapPayload(channel, response.status, await response.json()) as T
}

function invokeSync(channel: string, args: readonly unknown[]): unknown {
  const request = new XMLHttpRequest()
  request.open('POST', BROWSER_BRIDGE_ENDPOINT, false)
  request.setRequestHeader('Content-Type', 'application/json')
  request.send(JSON.stringify({ channel, args }))
  return unwrapPayload(channel, request.status, JSON.parse(request.responseText))
}

// Mirrors the Electron accelerator so the Alfred modal stays reachable in browser
// preview; the summon panel and microphone permissions have no browser equivalent.
function createAlfredApi(): AlfredApi {
  const modalListeners = new Set<() => void>()
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.code === 'Space') {
      event.preventDefault()
      modalListeners.forEach((listener) => listener())
    }
  })
  return {
    getShortcutStatus: () =>
      Promise.resolve({ accelerator: ALFRED_ACCELERATOR, registered: true }),
    requestMicrophonePermission: () =>
      Promise.resolve<AlfredMicrophonePermission>('unknown'),
    dismissPanel: () => Promise.resolve(),
    navigate: () => Promise.resolve(),
    onModalToggle: (listener) => {
      modalListeners.add(listener)
      return () => {
        modalListeners.delete(listener)
      }
    },
    onPanelVisibility: () => () => {},
    onNavigate: () => () => {}
  }
}

const homeApi: HomeApi = {
  load: (seed) => invoke<HomeState>('home:load', [seed]),
  upsertTask: (task) => invoke<Task>('home:upsert-task', [task]),
  deleteTask: (taskId) => invoke<void>('home:delete-task', [taskId]),
  addContext: (context) => invoke<ContextDefinition>('home:add-context', [context]),
  upsertScratchBlock: (block) => invoke<ScratchBlock>('home:upsert-scratch-block', [block]),
  deleteScratchBlock: (blockId) => invoke<void>('home:delete-scratch-block', [blockId]),
  upsertSavedTaskView: (view) => invoke<SavedTaskView>('home:upsert-saved-task-view', [view]),
  deleteSavedTaskView: (viewId) => invoke<void>('home:delete-saved-task-view', [viewId])
}

const habitsApi: HabitsApi = {
  load: (seed) => invoke<HabitsState>('habits:load', [seed]),
  createHabit: (draft) => invoke<HabitsState>('habits:create', [draft]),
  updateHabit: (habitId, draft) => invoke<HabitsState>('habits:update', [habitId, draft]),
  setEntry: (mutation) => invoke<HabitsState>('habits:set-entry', [mutation]),
  setStatus: (mutation) => invoke<HabitsState>('habits:set-status', [mutation]),
  deleteHabit: (habitId) => invoke<HabitsState>('habits:delete', [habitId])
}

const moodFocusApi: MoodFocusApi = {
  load: (seed) => invoke<MoodFocusState>('mood-focus:load', [seed]),
  setMood: (mutation) => invoke<MoodFocusState>('mood-focus:set-mood', [mutation]),
  setFocus: (mutation) => invoke<MoodFocusState>('mood-focus:set-focus', [mutation]),
  setNote: (mutation) => invoke<MoodFocusState>('mood-focus:set-note', [mutation])
}

const jobsApi: JobsApi = {
  load: (seed) => invoke<JobsState>('jobs:load', [seed]),
  createRole: (fields) => invoke<JobsState>('jobs:create-role', [fields]),
  updateRole: (mutation) => invoke<JobsState>('jobs:update-role', [mutation]),
  setStage: (mutation) => invoke<JobsState>('jobs:set-stage', [mutation]),
  deleteRole: (roleId) => invoke<JobsState>('jobs:delete-role', [roleId])
}

const leetCodeApi: LeetCodeApi = {
  load: (seed) => invoke<LeetCodeState>('leetcode:load', [seed]),
  addAttempt: (mutation) => invoke<LeetCodeState>('leetcode:add-attempt', [mutation]),
  updateAttempt: (mutation) => invoke<LeetCodeState>('leetcode:update-attempt', [mutation]),
  deleteAttempt: (attemptId) => invoke<LeetCodeState>('leetcode:delete-attempt', [attemptId])
}

const notesApi: NotesApi = {
  load: (seed) => invoke<NotesState>('notes:load', [seed]),
  createFolder: (draft) => invoke<NotesState>('notes:create-folder', [draft]),
  renameFolder: (mutation) => invoke<NotesState>('notes:rename-folder', [mutation]),
  deleteFolder: (folderId) => invoke<NotesState>('notes:delete-folder', [folderId]),
  createPage: (draft) => invoke<NotesState>('notes:create-page', [draft]),
  updatePage: (mutation) => invoke<NotePage>('notes:update-page', [mutation]),
  flushPage: (mutation) => parseNotePage(invokeSync('notes:update-page', [mutation])),
  touchPage: (pageId) => invoke<NotePage>('notes:touch-page', [pageId]),
  movePage: (mutation) => invoke<NotesState>('notes:move-page', [mutation]),
  duplicatePage: (pageId) => invoke<NotesState>('notes:duplicate-page', [pageId]),
  setFavorite: (mutation) => invoke<NotesState>('notes:set-favorite', [mutation]),
  archivePage: (pageId) => invoke<NotesState>('notes:archive-page', [pageId]),
  trashPage: (pageId) => invoke<NotesState>('notes:trash-page', [pageId]),
  restorePage: (pageId) => invoke<NotesState>('notes:restore-page', [pageId]),
  permanentlyDeletePage: (pageId) =>
    invoke<NotesState>('notes:permanently-delete-page', [pageId]),
  uploadAttachment: (upload) => invoke<NoteAttachment>('notes:upload-attachment', [upload]),
  resolveAttachment: (attachmentId) =>
    invoke<string>('notes:resolve-attachment', [attachmentId])
}

// In Electron the preload script exposes window.manor; in a browser tab the dev
// server hosts the same channels over HTTP, so preview stays fully functional.
export function installBrowserBridgeIfMissing(): void {
  if (window.manor !== undefined) return
  if (!import.meta.env.DEV) {
    throw new Error(
      'Manor bridge unavailable: the renderer is running outside Electron and the browser bridge only exists on the dev server'
    )
  }
  window.manor = {
    alfred: createAlfredApi(),
    home: homeApi,
    habits: habitsApi,
    jobs: jobsApi,
    leetcode: leetCodeApi,
    moodFocus: moodFocusApi,
    notes: notesApi
  }
}
