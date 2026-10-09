import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IpcChannels } from '@shared/ipcChannels'
import type { MiniPlayerCommand, MiniPlayerState } from '@shared/types'
import { getAllSettings, setSetting } from './db/repositories/settingsRepo'
import { getAppIconPath } from './iconPath'

// The pop-out mini player: a small always-on-top window that floats over Premiere.
// Playback stays in the main window; this process only relays — the main window
// sends its state here, it's forwarded to the mini player, and the mini player's
// button presses are forwarded back to the main window as commands.

const BOUNDS_KEY = 'bijoumusic:mini-bounds'
const WIDTH = 400
const HEIGHT = 116

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let lastState: MiniPlayerState = { track: null, isPlaying: false, currentTime: 0, duration: 0, theme: 'dark', volume: 0.8 }

function savedBounds(): Rectangle | null {
  try {
    const raw = getAllSettings()[BOUNDS_KEY]
    if (!raw) return null
    const bounds = JSON.parse(raw) as Rectangle
    // Only reuse a saved spot that's still on a connected monitor.
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return bounds.x >= a.x && bounds.y >= a.y && bounds.x + 40 <= a.x + a.width && bounds.y + 40 <= a.y + a.height
    })
    return onScreen ? bounds : null
  } catch {
    return null
  }
}

function defaultBounds(): Rectangle {
  const area = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds()).workArea
    : screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - WIDTH - 24, y: area.y + area.height - HEIGHT - 24, width: WIDTH, height: HEIGHT }
}

function notifyOpen(open: boolean): void {
  mainWindow?.webContents.send(IpcChannels.miniOpenChanged, open)
}

function openMiniPlayer(): void {
  if (miniWindow) {
    miniWindow.show()
    miniWindow.focus()
    return
  }
  const bounds = savedBounds() ?? defaultBounds()
  miniWindow = new BrowserWindow({
    ...bounds,
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'BijouMusic mini player',
    backgroundColor: '#0b0d10',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 'floating' keeps it above normal windows like Premiere without fighting
  // system-level overlays.
  miniWindow.setAlwaysOnTop(true, 'floating')
  miniWindow.once('ready-to-show', () => miniWindow?.show())
  miniWindow.on('moved', () => {
    if (miniWindow) setSetting(BOUNDS_KEY, JSON.stringify(miniWindow.getBounds()))
  })
  miniWindow.on('closed', () => {
    miniWindow = null
    notifyOpen(false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#mini`)
  } else {
    miniWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  }
  notifyOpen(true)
}

function closeMiniPlayer(): void {
  miniWindow?.close()
}

export function registerMiniPlayer(window: BrowserWindow): void {
  mainWindow = window
  window.on('closed', () => {
    closeMiniPlayer()
    mainWindow = null
  })
}

export function registerMiniPlayerIpc(): void {
  ipcMain.handle(IpcChannels.miniToggle, (): boolean => {
    if (miniWindow) closeMiniPlayer()
    else openMiniPlayer()
    return miniWindow !== null
  })

  ipcMain.handle(IpcChannels.miniGetState, (): MiniPlayerState => lastState)

  ipcMain.on(IpcChannels.miniState, (_event, state: MiniPlayerState) => {
    lastState = state
    miniWindow?.webContents.send(IpcChannels.miniState, state)
  })

  ipcMain.on(IpcChannels.miniCommand, (_event, command: MiniPlayerCommand) => {
    mainWindow?.webContents.send(IpcChannels.miniCommand, command)
  })

  ipcMain.on(IpcChannels.miniShowMain, () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  ipcMain.on(IpcChannels.miniClose, closeMiniPlayer)
}
