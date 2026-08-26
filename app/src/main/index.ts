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

import { closeManorStores, createBridgeChannels, createManorStores } from './bridgeChannels'
import type { ManorStores } from './bridgeChannels'
import { alfredPanelBounds, alfredShortcutStatus, alfredSummonTarget } from './alfredPanel'
import { ALFRED_ACCELERATOR, parseAlfredRoute } from '../shared/alfred'
import { captureToKnowledgeBase } from './captureService'
import { createAlfredCloudChannels } from './alfredCloudChannels'
import { createGcalChannels } from './gcalChannels'
import { createKbChannels } from './kbChannels'
import { createResumeChannels } from './resumeChannels'
import { createXChannels } from './xChannels'
import { electronAccountChannels, supabase } from './supabaseAuth'
import { SyncEngine, pullOnBoot, withAccountSync, withPushScheduling } from './syncEngine'

let manorStores: ManorStores | null = null
let mainWindow: BrowserWindow | null = null
let alfredPanelWindow: BrowserWindow | null = null
let alfredShortcutRegistered = false

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

function registerBridgeHandlers(stores: ManorStores, syncEngine: SyncEngine): void {
  const channels = withPushScheduling(createBridgeChannels(stores), syncEngine)
  for (const [channel, handler] of Object.entries(channels)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(args))
  }
  const updatePage = channels['notes:update-page']
  ipcMain.on('notes:flush-page', (event, mutationValue: unknown) => {
    try {
      event.returnValue = { ok: true, page: updatePage([mutationValue]) }
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
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

function hideAlfredPanel(): void {
  const panel = alfredPanelWindow
  if (panel === null || panel.isDestroyed()) return
  panel.webContents.send('alfred:panel-visibility', false)
  panel.hide()
}

let dockIcon: NativeImage | null = null

/* Creating or showing a panel-type window flips the macOS activation policy
   to accessory, which removes the dock icon; Manor is a regular app. The
   round trip can also reset the dock tile to Electron's stock icon in dev,
   so the Manor icon is re-applied every time the dock comes back. */
function restoreDockPresence(): void {
  if (process.platform !== 'darwin' || app.dock === undefined) return
  if (!app.dock.isVisible()) {
    void app.dock.show()
  }
  if (dockIcon !== null) {
    app.dock.setIcon(dockIcon)
  }
}

function showAlfredPanel(): void {
  const panel = alfredPanelWindow
  if (panel === null || panel.isDestroyed()) {
    throw new Error('Alfred panel is unavailable')
  }
  positionAlfredPanel(panel)
  // Focused show: the panel takes key input the moment it opens, so its own
  // renderer Escape handler covers dismissal; blur hides the panel otherwise.
  panel.show()
  restoreDockPresence()
  panel.webContents.send('alfred:panel-visibility', true)
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

function registerCloudHandlers(syncEngine: SyncEngine): void {
  const envRoot = app.isPackaged ? app.getPath('userData') : join(app.getAppPath(), '..')
  const cloudChannels = {
    ...withAccountSync(electronAccountChannels(), syncEngine),
    ...createResumeChannels(supabase),
    ...createKbChannels(supabase),
    ...createXChannels({ envRoot }, supabase),
    ...createGcalChannels({ envRoot, storageDir: app.getPath('userData') }),
    ...createAlfredCloudChannels(supabase)
  }
  for (const [channel, handler] of Object.entries(cloudChannels)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(args))
  }
  ipcMain.handle('capture:knowledge-base', async () => {
    // The shot must show what the user was looking at, not the summon panel.
    const panelWasVisible = alfredPanelWindow?.isVisible() ?? false
    if (panelWasVisible) {
      hideAlfredPanel()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return captureToKnowledgeBase()
  })
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
  dockIcon = icon
  if (process.platform === 'darwin' && app.dock !== undefined) {
    app.dock.setIcon(icon)
  }
  manorStores = createManorStores(
    join(app.getPath('userData'), 'manor.sqlite'),
    join(app.getPath('userData'), 'notes-attachments')
  )
  const syncEngine = new SyncEngine(manorStores, supabase)
  registerBridgeHandlers(manorStores, syncEngine)
  registerAlfredHandlers()
  registerCloudHandlers(syncEngine)
  void pullOnBoot(syncEngine, supabase).catch((error: unknown) => {
    console.error('manor-sync boot pull failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  })
  createWindow(icon)
  createAlfredPanel(icon)
  restoreDockPresence()
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
  globalShortcut.unregister(ALFRED_ACCELERATOR)
  if (manorStores !== null) {
    closeManorStores(manorStores)
    manorStores = null
  }
})
