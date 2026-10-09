import { app, ipcMain } from 'electron'
import { appendFile, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels } from '@shared/ipcChannels'

// A small "black box" for lag that comes and goes: appends a line whenever the app
// freezes for a noticeable moment (main process or the window), plus a memory/CPU
// snapshot every few minutes, to perf-log.txt in the app's data folder. Cheap
// enough to leave on; trimmed so it never grows past ~300 KB.

const MAX_BYTES = 300_000
const HEARTBEAT_MS = 200
const MAIN_BLOCK_THRESHOLD_MS = 400
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000

function logPath(): string {
  return join(app.getPath('userData'), 'perf-log.txt')
}

let writeChain: Promise<void> = Promise.resolve()

export function perfLog(line: string): void {
  const stamped = `${new Date().toISOString()}  ${line}\n`
  writeChain = writeChain
    .then(async () => {
      await appendFile(logPath(), stamped)
      const size = (await stat(logPath())).size
      if (size > MAX_BYTES) {
        const text = await readFile(logPath(), 'utf8')
        await writeFile(logPath(), text.slice(text.length / 2))
      }
    })
    .catch(() => {
      // Logging must never be able to break the app.
    })
}

function snapshot(): string {
  const parts = app.getAppMetrics().map((m) => {
    const mb = Math.round(m.memory.workingSetSize / 1024)
    return `${m.type}${m.name ? `(${m.name})` : ''} ${mb}MB ${Math.round(m.cpu.percentCPUUsage)}%cpu`
  })
  return `snapshot  ${parts.join(' | ')}`
}

export function startPerfWatchdog(): void {
  perfLog(`--- app started (v${app.getVersion()}) ---`)

  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const drift = now - last - HEARTBEAT_MS
    last = now
    if (drift > MAIN_BLOCK_THRESHOLD_MS) perfLog(`main process was blocked for about ${drift}ms`)
  }, HEARTBEAT_MS).unref()

  setInterval(() => perfLog(snapshot()), SNAPSHOT_EVERY_MS).unref()

  ipcMain.on(IpcChannels.perfLog, (_event, line: string) => {
    if (typeof line === 'string') perfLog(line.slice(0, 400))
  })
}
