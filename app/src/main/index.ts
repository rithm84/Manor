import {
  BrowserWindow,
  app,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'node:path'

import { HomeStore } from './homeStore'
import { CalendarStore } from './calendarStore'
import { HabitStore } from './habitStore'
import { JobStore } from './jobStore'
import { LeetCodeStore } from './leetCodeStore'
import { MoodFocusStore } from './moodFocusStore'
import { NotesStore } from './notesStore'
import { alfredPanelBounds, alfredShortcutStatus, alfredSummonTarget } from './alfredPanel'
import { ALFRED_ACCELERATOR, parseAlfredRoute } from '../shared/alfred'
import {
  parseCalendarDefinition,
  parseCalendarEvent,
  parseCalendarId,
  parseCalendarOccurrenceMutation,
  parseCalendarSeed,
  parseCalendarSettings
} from '../shared/calendar'
import {
  parseContext,
  parseContextDefinition,
  parseHomeSeed,
  parseSavedTaskView,
  parseScratchBlock,
  parseTask
} from '../shared/home'
import {
  parseHabitDraft,
  parseHabitLogMutation,
  parseHabitSeed,
  parseHabitStatusMutation
} from '../shared/habits'
import {
  parseFocusMutation,
  parseMoodFocusNoteMutation,
  parseMoodFocusSeed,
  parseMoodMutation
} from '../shared/moodFocus'
import {
  jobLocalDate,
  parseJobRoleFields,
  parseJobRoleId,
  parseJobRoleUpdate,
  parseJobsSeed,
  parseJobStageMutation
} from '../shared/jobs'
import {
  leetCodeLocalDate,
  parseAddLeetCodeAttemptMutation,
  parseLeetCodeId,
  parseLeetCodeSeed,
  parseUpdateLeetCodeAttemptMutation
} from '../shared/leetcode'
import {
  parseNoteAttachmentUpload,
  parseNoteFolderDraft,
  parseNoteFolderRename,
  parseNoteId,
  parseNotePageContentUpdate,
  parseNotePageDraft,
  parseNotePageFavoriteMutation,
  parseNotePageMove,
  parseNotesSeed
} from '../shared/notes'

function localIsoDate(date: Date): string {
  return leetCodeLocalDate(date)
}

let homeStore: HomeStore | null = null
let calendarStore: CalendarStore | null = null
let habitStore: HabitStore | null = null
let jobStore: JobStore | null = null
let leetCodeStore: LeetCodeStore | null = null
let moodFocusStore: MoodFocusStore | null = null
let notesStore: NotesStore | null = null
let mainWindow: BrowserWindow | null = null
let alfredPanelWindow: BrowserWindow | null = null
let alfredShortcutRegistered = false
let alfredEscapeRegistered = false

const ALFRED_PANEL_WIDTH = 472
const ALFRED_PANEL_HEIGHT = 576

app.setName('Manor')

function applicationIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

function applicationIcon(): NativeImage {
  const iconPath = applicationIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    throw new Error(`Manor application icon could not be loaded from ${iconPath}`)
  }
  return icon
}

function store(): HomeStore {
  if (homeStore === null) {
    throw new Error('Home store is unavailable before the Electron app is ready')
  }
  return homeStore
}

function calendar(): CalendarStore {
  if (calendarStore === null) {
    throw new Error('Calendar store is unavailable before the Electron app is ready')
  }
  return calendarStore
}

function habits(): HabitStore {
  if (habitStore === null) {
    throw new Error('Habit store is unavailable before the Electron app is ready')
  }
  return habitStore
}

function moodFocus(): MoodFocusStore {
  if (moodFocusStore === null) {
    throw new Error('Mood and focus store is unavailable before the Electron app is ready')
  }
  return moodFocusStore
}

function jobs(): JobStore {
  if (jobStore === null) {
    throw new Error('Jobs store is unavailable before the Electron app is ready')
  }
  return jobStore
}

function leetCode(): LeetCodeStore {
  if (leetCodeStore === null) {
    throw new Error('LeetCode store is unavailable before the Electron app is ready')
  }
  return leetCodeStore
}

function notes(): NotesStore {
  if (notesStore === null) {
    throw new Error('Notes store is unavailable before the Electron app is ready')
  }
  return notesStore
}

function registerHomeHandlers(): void {
  ipcMain.handle('home:load', (_event, seedValue: unknown) =>
    store().load(parseHomeSeed(seedValue), new Date().toISOString())
  )
  ipcMain.handle('home:upsert-task', (_event, taskValue: unknown) =>
    store().upsertTask(parseTask(taskValue), new Date().toISOString())
  )
  ipcMain.handle('home:delete-task', (_event, taskIdValue: unknown) =>
    store().deleteTask(parseContext(taskIdValue))
  )
  ipcMain.handle('home:add-context', (_event, contextValue: unknown) =>
    store().addContext(parseContextDefinition(contextValue))
  )
  ipcMain.handle('home:upsert-scratch-block', (_event, blockValue: unknown) =>
    store().upsertScratchBlock(parseScratchBlock(blockValue), new Date().toISOString())
  )
  ipcMain.handle('home:delete-scratch-block', (_event, blockIdValue: unknown) =>
    store().deleteScratchBlock(parseContext(blockIdValue))
  )
  ipcMain.handle('home:upsert-saved-task-view', (_event, viewValue: unknown) =>
    store().upsertSavedTaskView(parseSavedTaskView(viewValue), new Date().toISOString())
  )
  ipcMain.handle('home:delete-saved-task-view', (_event, viewIdValue: unknown) =>
    store().deleteSavedTaskView(parseContext(viewIdValue))
  )
}

function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:load', (_event, seedValue: unknown) =>
    calendar().load(parseCalendarSeed(seedValue))
  )
  ipcMain.handle('calendar:upsert-calendar', (_event, calendarValue: unknown) =>
    calendar().upsertCalendar(parseCalendarDefinition(calendarValue))
  )
  ipcMain.handle('calendar:delete-calendar', (_event, calendarIdValue: unknown) =>
    calendar().deleteCalendar(parseCalendarId(calendarIdValue, 'calendar id'))
  )
  ipcMain.handle('calendar:upsert-event', (_event, eventValue: unknown) =>
    calendar().upsertEvent(parseCalendarEvent(eventValue))
  )
  ipcMain.handle('calendar:replace-occurrence', (_event, mutationValue: unknown) =>
    calendar().replaceOccurrence(parseCalendarOccurrenceMutation(mutationValue))
  )
  ipcMain.handle('calendar:delete-event', (_event, eventIdValue: unknown) =>
    calendar().deleteEvent(parseCalendarId(eventIdValue, 'calendar event id'))
  )
  ipcMain.handle('calendar:update-settings', (_event, settingsValue: unknown) =>
    calendar().updateSettings(parseCalendarSettings(settingsValue))
  )
}

function registerHabitHandlers(): void {
  ipcMain.handle('habits:load', (_event, seedValue: unknown) =>
    habits().load(parseHabitSeed(seedValue))
  )
  ipcMain.handle('habits:create', (_event, draftValue: unknown) =>
    habits().createHabit(parseHabitDraft(draftValue), new Date().toISOString())
  )
  ipcMain.handle('habits:update', (_event, habitId: string, draftValue: unknown) =>
    habits().updateHabit(habitId, parseHabitDraft(draftValue), new Date().toISOString())
  )
  ipcMain.handle('habits:set-entry', (_event, mutationValue: unknown) =>
    habits().setEntry(parseHabitLogMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('habits:set-status', (_event, mutationValue: unknown) =>
    habits().setStatus(parseHabitStatusMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('habits:delete', (_event, habitId: string) => habits().deleteHabit(habitId))
}

function registerMoodFocusHandlers(): void {
  ipcMain.handle('mood-focus:load', (_event, seedValue: unknown) =>
    moodFocus().load(parseMoodFocusSeed(seedValue))
  )
  ipcMain.handle('mood-focus:set-mood', (_event, mutationValue: unknown) =>
    moodFocus().setMood(parseMoodMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('mood-focus:set-focus', (_event, mutationValue: unknown) =>
    moodFocus().setFocus(parseFocusMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('mood-focus:set-note', (_event, mutationValue: unknown) =>
    moodFocus().setNote(parseMoodFocusNoteMutation(mutationValue), new Date().toISOString())
  )
}

function registerJobHandlers(): void {
  ipcMain.handle('jobs:load', (_event, seedValue: unknown) =>
    jobs().load(parseJobsSeed(seedValue), jobLocalDate(new Date()))
  )
  ipcMain.handle('jobs:create-role', (_event, fieldsValue: unknown) =>
    jobs().createRole(parseJobRoleFields(fieldsValue), new Date().toISOString())
  )
  ipcMain.handle('jobs:update-role', (_event, mutationValue: unknown) =>
    jobs().updateRole(parseJobRoleUpdate(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('jobs:set-stage', (_event, mutationValue: unknown) =>
    jobs().setStage(parseJobStageMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('jobs:delete-role', (_event, roleIdValue: unknown) =>
    jobs().deleteRole(parseJobRoleId(roleIdValue))
  )
}

function registerLeetCodeHandlers(): void {
  ipcMain.handle('leetcode:load', (_event, seedValue: unknown) =>
    leetCode().load(parseLeetCodeSeed(seedValue), localIsoDate(new Date()))
  )
  ipcMain.handle('leetcode:add-attempt', (_event, mutationValue: unknown) =>
    leetCode().addAttempt(parseAddLeetCodeAttemptMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('leetcode:update-attempt', (_event, mutationValue: unknown) =>
    leetCode().updateAttempt(
      parseUpdateLeetCodeAttemptMutation(mutationValue),
      new Date().toISOString()
    )
  )
  ipcMain.handle('leetcode:delete-attempt', (_event, attemptIdValue: unknown) =>
    leetCode().deleteAttempt(parseLeetCodeId(attemptIdValue, 'attempt id'))
  )
}

function registerNotesHandlers(): void {
  ipcMain.handle('notes:load', (_event, seedValue: unknown) =>
    notes().load(parseNotesSeed(seedValue))
  )
  ipcMain.handle('notes:create-folder', (_event, draftValue: unknown) =>
    notes().createFolder(parseNoteFolderDraft(draftValue), new Date().toISOString())
  )
  ipcMain.handle('notes:rename-folder', (_event, mutationValue: unknown) =>
    notes().renameFolder(parseNoteFolderRename(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('notes:delete-folder', (_event, folderIdValue: unknown) =>
    notes().deleteFolder(parseNoteId(folderIdValue, 'folder id'), new Date().toISOString())
  )
  ipcMain.handle('notes:create-page', (_event, draftValue: unknown) =>
    notes().createPage(parseNotePageDraft(draftValue), new Date().toISOString())
  )
  ipcMain.handle('notes:update-page', (_event, mutationValue: unknown) =>
    notes().updatePage(parseNotePageContentUpdate(mutationValue), new Date().toISOString())
  )
  ipcMain.on('notes:flush-page', (event, mutationValue: unknown) => {
    try {
      event.returnValue = {
        ok: true,
        page: notes().updatePage(parseNotePageContentUpdate(mutationValue), new Date().toISOString())
      }
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('notes:touch-page', (_event, pageIdValue: unknown) =>
    notes().touchPage(parseNoteId(pageIdValue, 'note id'), new Date().toISOString())
  )
  ipcMain.handle('notes:move-page', (_event, mutationValue: unknown) =>
    notes().movePage(parseNotePageMove(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('notes:duplicate-page', (_event, pageIdValue: unknown) =>
    notes().duplicatePage(parseNoteId(pageIdValue, 'note id'), new Date().toISOString())
  )
  ipcMain.handle('notes:set-favorite', (_event, mutationValue: unknown) =>
    notes().setFavorite(parseNotePageFavoriteMutation(mutationValue), new Date().toISOString())
  )
  ipcMain.handle('notes:archive-page', (_event, pageIdValue: unknown) =>
    notes().archivePage(parseNoteId(pageIdValue, 'note id'), new Date().toISOString())
  )
  ipcMain.handle('notes:trash-page', (_event, pageIdValue: unknown) =>
    notes().trashPage(parseNoteId(pageIdValue, 'note id'), new Date().toISOString())
  )
  ipcMain.handle('notes:restore-page', (_event, pageIdValue: unknown) =>
    notes().restorePage(parseNoteId(pageIdValue, 'note id'), new Date().toISOString())
  )
  ipcMain.handle('notes:permanently-delete-page', (_event, pageIdValue: unknown) =>
    notes().permanentlyDeletePage(parseNoteId(pageIdValue, 'note id'))
  )
  ipcMain.handle('notes:upload-attachment', (_event, uploadValue: unknown) =>
    notes().uploadAttachment(parseNoteAttachmentUpload(uploadValue), new Date().toISOString())
  )
  ipcMain.handle('notes:resolve-attachment', (_event, attachmentIdValue: unknown) =>
    notes().resolveAttachment(parseNoteId(attachmentIdValue, 'attachment id'))
  )
}

function panelRendererUrl(): string | null {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return !app.isPackaged && devServerUrl !== undefined
    ? `${devServerUrl}#/alfred-panel`
    : null
}

function positionAlfredPanel(panel: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  panel.setBounds(
    alfredPanelBounds({
      workAreaX: display.workArea.x,
      workAreaY: display.workArea.y,
      workAreaWidth: display.workArea.width,
      workAreaHeight: display.workArea.height,
      panelWidth: ALFRED_PANEL_WIDTH,
      panelHeight: ALFRED_PANEL_HEIGHT
    })
  )
}

function unregisterAlfredEscape(): void {
  if (!alfredEscapeRegistered) return
  globalShortcut.unregister('Escape')
  alfredEscapeRegistered = false
}

function hideAlfredPanel(): void {
  const panel = alfredPanelWindow
  if (panel === null || panel.isDestroyed()) return
  panel.webContents.send('alfred:panel-visibility', false)
  panel.hide()
  unregisterAlfredEscape()
}

function showAlfredPanel(): void {
  const panel = alfredPanelWindow
  if (panel === null || panel.isDestroyed()) {
    throw new Error('Alfred panel is unavailable')
  }
  positionAlfredPanel(panel)
  panel.showInactive()
  panel.webContents.send('alfred:panel-visibility', true)
  if (!globalShortcut.isRegistered('Escape')) {
    alfredEscapeRegistered = globalShortcut.register('Escape', hideAlfredPanel)
    if (!alfredEscapeRegistered) {
      console.error('Alfred panel Escape shortcut registration failed', { accelerator: 'Escape' })
    }
  }
}

function summonAlfred(): void {
  const panelVisible = alfredPanelWindow?.isVisible() ?? false
  const target = alfredSummonTarget(mainWindow?.isFocused() ?? false, panelVisible)
  if (target === 'modal') {
    mainWindow?.webContents.send('alfred:toggle-modal')
  } else if (target === 'show-panel') {
    showAlfredPanel()
  } else {
    hideAlfredPanel()
  }
}

function createAlfredPanel(icon: NativeImage): void {
  const panel = new BrowserWindow({
    width: ALFRED_PANEL_WIDTH,
    height: ALFRED_PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    icon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  alfredPanelWindow = panel
  panel.setAlwaysOnTop(true, 'floating')
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  panel.setHiddenInMissionControl(true)
  panel.on('blur', hideAlfredPanel)
  panel.webContents.on('did-finish-load', () => {
    if (panel.isVisible()) panel.webContents.send('alfred:panel-visibility', true)
  })
  panel.on('closed', () => {
    unregisterAlfredEscape()
    alfredPanelWindow = null
  })

  const rendererUrl = panelRendererUrl()
  if (rendererUrl !== null) {
    void panel.loadURL(rendererUrl)
  } else {
    void panel.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      hash: '/alfred-panel'
    })
  }
}

function microphonePermission(): string {
  return process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('microphone')
    : 'unknown'
}

function registerAlfredHandlers(): void {
  ipcMain.handle('alfred:get-shortcut-status', () =>
    alfredShortcutStatus(alfredShortcutRegistered)
  )
  ipcMain.handle('alfred:request-microphone-permission', async () => {
    const current = microphonePermission()
    if (process.platform !== 'darwin' || current !== 'not-determined') return current
    await systemPreferences.askForMediaAccess('microphone')
    return microphonePermission()
  })
  ipcMain.handle('alfred:dismiss-panel', () => hideAlfredPanel())
  ipcMain.handle('alfred:navigate', (_event, routeValue: unknown) => {
    const route = parseAlfredRoute(routeValue)
    hideAlfredPanel()
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('alfred:navigate', route)
  })
}

function createWindow(icon: NativeImage): void {
  const window = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#faf9f5',
    icon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    let external: URL
    try {
      external = new URL(details.url)
    } catch {
      return { action: 'deny' }
    }
    if (external.protocol === 'https:' || external.protocol === 'http:') {
      void shell.openExternal(external.toString()).catch((error: unknown) => {
        console.error('External URL failed to open', { url: external.toString(), error })
      })
    }
    return { action: 'deny' }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl !== undefined) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const icon = applicationIcon()
  if (process.platform === 'darwin' && app.dock !== undefined) {
    app.dock.setIcon(icon)
  }
  const databasePath = join(app.getPath('userData'), 'manor.sqlite')
  homeStore = new HomeStore(databasePath)
  calendarStore = new CalendarStore(databasePath)
  habitStore = new HabitStore(databasePath)
  jobStore = new JobStore(databasePath)
  leetCodeStore = new LeetCodeStore(databasePath)
  moodFocusStore = new MoodFocusStore(databasePath)
  notesStore = new NotesStore(databasePath, join(app.getPath('userData'), 'notes-attachments'))
  registerHomeHandlers()
  registerCalendarHandlers()
  registerHabitHandlers()
  registerJobHandlers()
  registerLeetCodeHandlers()
  registerMoodFocusHandlers()
  registerNotesHandlers()
  registerAlfredHandlers()
  createWindow(icon)
  createAlfredPanel(icon)
  alfredShortcutRegistered = globalShortcut.register(ALFRED_ACCELERATOR, summonAlfred)
  if (!alfredShortcutRegistered) {
    console.error('Alfred summon shortcut registration failed', {
      accelerator: ALFRED_ACCELERATOR
    })
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trustedRenderer =
      webContents === mainWindow?.webContents || webContents === alfredPanelWindow?.webContents
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
    const audioOnly =
      permission === 'media' &&
      mediaTypes?.includes('audio') === true &&
      mediaTypes.includes('video') === false
    callback(trustedRenderer && audioOnly)
  })

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow(icon)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  unregisterAlfredEscape()
  globalShortcut.unregister(ALFRED_ACCELERATOR)
  leetCodeStore?.close()
  leetCodeStore = null
  notesStore?.close()
  notesStore = null
  jobStore?.close()
  jobStore = null
  moodFocusStore?.close()
  moodFocusStore = null
  habitStore?.close()
  habitStore = null
  homeStore?.close()
  homeStore = null
  calendarStore?.close()
  calendarStore = null
})
