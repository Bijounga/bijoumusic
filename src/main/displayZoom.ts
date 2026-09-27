import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import { getAllSettings, setSetting } from './db/repositories/settingsRepo'

// A separate UI zoom per monitor. Windows display scaling differs per monitor
// (a 4K screen at 150–200% leaves far less room than a 1080p one at 100%), so a
// zoom that suits one screen is wrong on another. Each monitor remembers its
// own zoom, and it's re-applied whenever the window lands on that monitor.

const SETTING_KEY = 'bijoumusic:display-zoom'
const STEP = 0.1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2

// Keyed by resolution + scale rather than Electron's display id, which isn't
// stable across reboots or reconnects.
function displayKey(display: Display): string {
  return `${display.size.width}x${display.size.height}@${display.scaleFactor}`
}

function loadZooms(): Record<string, number> {
  try {
    const raw = getAllSettings()[SETTING_KEY]
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10
}

export function attachDisplayZoom(window: BrowserWindow): void {
  const zooms = loadZooms()
  let currentKey = ''

  const currentDisplay = (): Display => screen.getDisplayMatching(window.getBounds())

  const apply = (zoom: number, announce: boolean): void => {
    window.webContents.setZoomFactor(zoom)
    if (announce) window.webContents.send(IpcChannels.windowZoomChanged, zoom)
  }

  // Re-apply only when the window has actually changed monitors.
  const syncToDisplay = (): void => {
    const key = displayKey(currentDisplay())
    if (key === currentKey) return
    currentKey = key
    apply(zooms[key] ?? 1, false)
  }

  const step = (delta: number | null): void => {
    const key = displayKey(currentDisplay())
    currentKey = key
    const next = delta === null ? 1 : clampZoom((zooms[key] ?? 1) + delta)
    zooms[key] = next
    setSetting(SETTING_KEY, JSON.stringify(zooms))
    apply(next, true)
  }

  window.webContents.on('did-finish-load', () => {
    currentKey = ''
    syncToDisplay()
  })
  window.on('moved', syncToDisplay)
  window.on('maximize', syncToDisplay)
  window.on('unmaximize', syncToDisplay)
  screen.on('display-metrics-changed', syncToDisplay)
  window.on('closed', () => screen.removeListener('display-metrics-changed', syncToDisplay))

  // Handled here rather than in the renderer so it beats Electron's hidden
  // default menu, whose own zoom accelerators would otherwise fire too.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
    if (input.key === '=' || input.key === '+') step(STEP)
    else if (input.key === '-' || input.key === '_') step(-STEP)
    else if (input.key === '0') step(null)
    else return
    event.preventDefault()
  })

  // Ctrl + mouse wheel.
  window.webContents.on('zoom-changed', (_event, direction) => {
    step(direction === 'in' ? STEP : -STEP)
  })
}
