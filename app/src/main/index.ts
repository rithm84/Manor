import { BrowserWindow, app, ipcMain, nativeImage, shell } from 'electron'
import type { NativeImage } from 'electron'
import { join } from 'node:path'

import { HomeStore } from './homeStore'
import { HabitStore } from './habitStore'
import { JobStore } from './jobStore'
import { LeetCodeStore } from './leetCodeStore'
import { MoodFocusStore } from './moodFocusStore'
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

function localIsoDate(date: Date): string {
  return leetCodeLocalDate(date)
}

let homeStore: HomeStore | null = null
let habitStore: HabitStore | null = null
let jobStore: JobStore | null = null
let leetCodeStore: LeetCodeStore | null = null
let moodFocusStore: MoodFocusStore | null = null

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

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
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
  habitStore = new HabitStore(databasePath)
  jobStore = new JobStore(databasePath)
  leetCodeStore = new LeetCodeStore(databasePath)
  moodFocusStore = new MoodFocusStore(databasePath)
  registerHomeHandlers()
  registerHabitHandlers()
  registerJobHandlers()
  registerLeetCodeHandlers()
  registerMoodFocusHandlers()
  createWindow(icon)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
  leetCodeStore?.close()
  leetCodeStore = null
  jobStore?.close()
  jobStore = null
  moodFocusStore?.close()
  moodFocusStore = null
  habitStore?.close()
  habitStore = null
  homeStore?.close()
  homeStore = null
})
