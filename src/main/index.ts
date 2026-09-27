import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IpcChannels } from '@shared/ipcChannels'
import type { AppInfo } from '@shared/types'
import { initDatabase, closeDatabase, refreshDatabaseConnection } from './db/database'
import { registerLibraryIpc } from './ipc/library.ipc'
import { registerPlaybackIpc } from './ipc/playback.ipc'
import { registerWaveformIpc } from './ipc/waveform.ipc'
import { registerTagsIpc } from './ipc/tags.ipc'
import { registerRatingsIpc } from './ipc/ratings.ipc'
import { registerAliasesIpc } from './ipc/aliases.ipc'
import { registerProjectsIpc } from './ipc/projects.ipc'
import { registerAlbumArtIpc } from './ipc/albumArt.ipc'
import { registerBookmarksIpc } from './ipc/bookmarks.ipc'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerPremiereIpc } from './ipc/premiere.ipc'
import { registerDownloaderIpc } from './ipc/downloader.ipc'
import { registerWindowIpc } from './ipc/window.ipc'
import { attachDisplayZoom } from './displayZoom'
import { registerAudioProtocolScheme, registerAudioProtocolHandler } from './protocol'
import { getAppIconPath } from './iconPath'
import { startPremiereBridge, stopPremiereBridge } from './premiereBridge'

// Pinned to the original folder name so renaming the app's display name doesn't
// orphan the existing library database — data location and display name are
// intentionally decoupled. An explicit --user-data-dir still wins, so test runs
// can point at a throwaway profile instead of the real library.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'music-browser'))
}
app.setName('BijouMusic')

// The portable Windows build self-extracts and runs fresh from a temp folder on
// every launch, so nothing stops a second copy from starting (e.g. a slow-to-open
// exe getting double-clicked again, or a leftover instance never fully closing) —
// and with no lock, two copies both hit the same SQLite file with zero
// coordination between them, which is a real way to corrupt it. This claims the
// lock before anything else touches the database; a second launch just focuses
// the existing window instead of starting its own instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  registerAudioProtocolScheme()
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // Frameless so each theme can draw its own title bar (components/layout/TitleBar).
    // Windows still provides resize edges, snapping by drag, and the window shadow.
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  attachDisplayZoom(window)

  window.on('maximize', () => window.webContents.send(IpcChannels.windowMaximizedChanged, true))
  window.on('unmaximize', () => window.webContents.send(IpcChannels.windowMaximizedChanged, false))

  // Confirmed via direct testing: the long-lived database connection can end up
  // reading stale data relative to what's actually on disk (root cause never
  // pinned down — a brand-new connection to the same file always reads
  // correctly, so this forces exactly that on every refocus, which is also the
  // most natural moment for "something might have changed while I was away").
  window.on('focus', () => {
    refreshDatabaseConnection()
      .then(() => window.webContents.send(IpcChannels.databaseRefreshed))
      .catch((err) => console.error('[index] refreshDatabaseConnection on focus failed:', err))
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.ibrahim.bijoumusic')

    await initDatabase()
    registerAudioProtocolHandler()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ipcMain.handle(IpcChannels.appInfo, (): AppInfo => {
      return { version: app.getVersion(), platform: process.platform }
    })

    registerLibraryIpc()
    registerPlaybackIpc()
    registerWaveformIpc()
    registerTagsIpc()
    registerRatingsIpc()
    registerAliasesIpc()
    registerProjectsIpc()
    registerAlbumArtIpc()
    registerBookmarksIpc()
    registerSettingsIpc()
    registerPremiereIpc()
    registerDownloaderIpc()
    registerWindowIpc()
    startPremiereBridge()

    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    closeDatabase()
    stopPremiereBridge()
  })
}
