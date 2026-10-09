import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { IpcChannels } from '@shared/ipcChannels'
import type { UpdateStatus } from '@shared/types'
import * as macUpdate from './macUpdate'
import { tidyUpdateCache } from './updateCache'
import { perfLog } from './perfLog'

// Self-update from GitHub Releases, modelled on BijouDocs / Bijou Footage.
//
//   Windows: electron-updater does everything (NSIS installer). The new version
//            downloads in the background; "Restart to update" closes the app,
//            installs silently and reopens it.
//   macOS:   electron-updater only *finds* the update. Its own install path goes
//            through Squirrel.Mac, which needs an Apple-signed app, so
//            macUpdate.ts downloads the Release .zip and swaps the app in place
//            itself (no disk image to drag or eject).
//
// A check runs a few seconds after launch and every few hours; the logo at the
// top of the sidebar also checks on click. Does nothing in dev (no packaged app
// and no update feed).

const REPO = 'Bijounga/bijoumusic'
const FIRST_CHECK_DELAY_MS = 6000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null
let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }

function setStatus(next: Omit<UpdateStatus, 'currentVersion'>): void {
  status = { ...next, currentVersion: app.getVersion() }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannels.updateStatus, status)
}

// Whether the check in progress was started by a click on the logo. Automatic
// checks stay quiet when they find nothing or fail (offline, no release yet) —
// only a check you asked for reports "up to date" or an error.
let manualCheck = false

function checkForUpdates(manual: boolean): void {
  // Don't interrupt a download or an update that's already waiting.
  if (['checking', 'downloading', 'downloaded'].includes(status.state)) return
  manualCheck = manual
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    perfLog(`update check failed: ${message}`)
    setStatus(manualCheck ? { state: 'error', message } : { state: 'idle' })
  })
}

export function registerUpdaterIpc(): void {
  ipcMain.handle(IpcChannels.updateGetStatus, (): UpdateStatus => status)

  ipcMain.handle(IpcChannels.updateCheckNow, () => {
    if (!app.isPackaged) {
      setStatus({ state: 'dev' })
      return
    }
    checkForUpdates(true)
  })

  ipcMain.handle(IpcChannels.updateInstallNow, () => {
    if (isMac) {
      macUpdate.installAndRelaunch(true)
      return
    }
    // Both args matter: without them the Windows installer runs its full wizard
    // on every update. `true, true` installs silently and reopens the app.
    autoUpdater.quitAndInstall(true, true)
  })

  ipcMain.on(IpcChannels.updateOpenReleases, () => {
    void shell.openExternal(`https://github.com/${REPO}/releases/latest`)
  })
}

let started = false

export function startUpdater(window: BrowserWindow): void {
  mainWindow = window
  if (!app.isPackaged) {
    setStatus({ state: 'dev' })
    return
  }
  // On macOS the window can be recreated from the dock; the listeners and timers
  // below must only be set up once.
  if (started) return
  started = true

  // Eject the install disk image, drop old update downloads, and offer to move
  // into Applications if launched from the .dmg.
  if (isMac) macUpdate.tidyOnLaunch().catch((err) => perfLog(`mac tidy failed: ${err}`))
  else {
    // Windows: delete the installer a finished update left in the updater's cache.
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    const removed = tidyUpdateCache(join(localAppData, 'bijoumusic-updater', 'pending'), app.getVersion())
    if (removed.length > 0) perfLog(`removed finished update download: ${removed.join(', ')}`)
  }

  autoUpdater.autoDownload = !isMac
  autoUpdater.autoInstallOnAppQuit = !isMac

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    if (!isMac) {
      setStatus({ state: 'downloading', version: info.version, percent: 0 })
      return
    }
    if (!macUpdate.canSelfUpdate()) {
      // Running from the disk image, or the app's folder isn't writable.
      setStatus({ state: 'available-manual', version: info.version })
      return
    }
    setStatus({ state: 'downloading', version: info.version, percent: 0 })
    const base = `https://github.com/${REPO}/releases/download/v${info.version}/`
    macUpdate
      .download(info, base, (percent) => setStatus({ state: 'downloading', version: info.version, percent }))
      .then(() => setStatus({ state: 'downloaded', version: info.version }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        perfLog(`mac update download failed: ${message}`)
        setStatus({ state: 'error', message })
      })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', version: status.version, percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'downloaded', version: info.version }))
  autoUpdater.on('update-not-available', () => setStatus({ state: manualCheck ? 'not-available' : 'idle' }))
  autoUpdater.on('error', (err) => {
    perfLog(`auto-update error: ${err?.message ?? err}`)
    setStatus(manualCheck ? { state: 'error', message: err?.message } : { state: 'idle' })
  })

  // Quitting with a Mac update waiting installs it (without reopening).
  if (isMac) {
    app.on('will-quit', () => {
      if (macUpdate.isReady()) macUpdate.installAndRelaunch(false)
    })
  }

  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  setInterval(() => checkForUpdates(false), CHECK_EVERY_MS).unref()
}
