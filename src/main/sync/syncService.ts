import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { hostname } from 'os'
import { dirname, join } from 'path'
import { IpcChannels } from '@shared/ipcChannels'
import type { SyncStatus } from '@shared/types'
import { getDb, getDbPath, isDatabaseOpen } from '../db/database'
import { listLibraryRoots } from '../db/repositories/libraryRootsRepo'
import { perfLog } from '../perfLog'
import { applyMerged, buildLocalSnapshot } from './syncDb'
import { mergeEntries, nextBase, preferRemoteMachine, type Entries, type SyncSnapshot } from './syncMerge'

// Keeps tags, ratings, aliases, bookmarks and projects the same on every machine
// by exchanging small snapshot files through a folder the cloud drive syncs. Each
// machine writes only its own file there and merges everyone else's into its
// database — see syncMerge.ts for the rules. Nothing here touches the music files.

const FOLDER_NAME = 'BijouMusic Sync'
const INTERVAL_MS = 5 * 60 * 1000
const BACKUPS_TO_KEEP = 3
// A merge that would delete this much of what's here is more likely a damaged or
// reset file on the other machine than a real edit — refuse and say so.
const MASS_DELETE_MIN = 500
const MASS_DELETE_FRACTION = 0.4

type Reason = 'startup' | 'interval' | 'scan' | 'blur' | 'focus' | 'manual' | 'queued'

interface PersistedState {
  machineId: string
  startedAt: number
  folder?: string
}

let state: PersistedState | null = null
let status: SyncStatus = { state: 'off' }
let mainWindow: BrowserWindow | null = null
let started = false
let running: Promise<void> | null = null
let rerunReason: Reason | null = null
let lastWrittenSig: string | null = null
const lastSeenRemote = new Map<string, string>()
const timers = new Map<Reason, NodeJS.Timeout>()

function statePath(): string {
  return join(app.getPath('userData'), 'sync-state.json')
}

function baseDir(): string {
  return join(app.getPath('userData'), 'sync-base')
}

function loadState(): PersistedState {
  if (state) return state
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as PersistedState
    if (parsed.machineId) {
      state = parsed
      if (!state.startedAt) {
        state.startedAt = Date.now()
        saveState()
      }
      return state
    }
  } catch {
    // First run (or an unreadable file): start a fresh identity.
  }
  state = { machineId: randomUUID(), startedAt: Date.now() }
  saveState()
  return state
}

function saveState(): void {
  if (state) writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

function machineFileName(): string {
  const id = loadState().machineId
  const name = hostname().replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'machine'
  return `${name}-${id.slice(0, 8)}.json`
}

function setStatus(next: SyncStatus): void {
  status = next
  mainWindow?.webContents.send(IpcChannels.syncStatus, status)
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function waitForDb(): Promise<void> {
  for (let i = 0; i < 20 && !isDatabaseOpen(); i++) await new Promise((r) => setTimeout(r, 150))
  if (!isDatabaseOpen()) throw new Error('The library database is not open')
}

/** The sync folder, if there is one: the saved one, or — on a machine that hasn't
 *  been set up — one that already sits next to a library folder (that's how a second
 *  computer finds the folder the first one created). */
async function resolveFolder(): Promise<string | null> {
  const current = loadState()
  if (current.folder) return (await isDir(current.folder)) ? current.folder : null
  for (const root of listLibraryRoots()) {
    const candidate = join(dirname(root.path), FOLDER_NAME)
    if (await isDir(candidate)) {
      current.folder = candidate
      saveState()
      return candidate
    }
  }
  return null
}

function signature(tracks: string[], entries: Entries): string {
  // startedAt is part of what's published too, so it is part of what counts as a change.
  return createHash('sha1').update(JSON.stringify([loadState().startedAt, tracks, entries])).digest('hex')
}

function sortedEntries(entries: Entries): Entries {
  const sorted: Entries = {}
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key]
  return sorted
}

function snapshotBody(): { tracks: string[]; entries: Entries } | null {
  const local = buildLocalSnapshot()
  // A library that hasn't scanned anything yet has nothing worth publishing.
  if (local.tracks.size === 0) return null
  return { tracks: [...local.tracks].sort(), entries: sortedEntries(local.entries) }
}

function serialize(body: { tracks: string[]; entries: Entries }): string {
  const snapshot: SyncSnapshot = {
    version: 1,
    machineId: loadState().machineId,
    machineName: hostname(),
    writtenAt: Date.now(),
    startedAt: loadState().startedAt,
    tracks: body.tracks,
    entries: body.entries
  }
  return JSON.stringify(snapshot)
}

function parseSnapshot(text: string): SyncSnapshot | null {
  try {
    const parsed = JSON.parse(text) as SyncSnapshot
    if (parsed.version !== 1 || typeof parsed.machineId !== 'string') return null
    if (!Array.isArray(parsed.tracks) || typeof parsed.entries !== 'object' || parsed.entries === null) return null
    return parsed
  } catch {
    return null
  }
}

async function exportOwn(folder: string): Promise<void> {
  const target = join(folder, machineFileName())
  if (lastWrittenSig === null) {
    try {
      const existing = parseSnapshot(await readFile(target, 'utf8'))
      lastWrittenSig =
        existing && existing.startedAt === loadState().startedAt ? signature(existing.tracks, sortedEntries(existing.entries)) : ''
    } catch {
      lastWrittenSig = ''
    }
  }
  await waitForDb()
  const body = snapshotBody()
  if (!body) return
  const sig = signature(body.tracks, body.entries)
  if (sig === lastWrittenSig) return
  const temp = `${target}.tmp`
  await writeFile(temp, serialize(body))
  await rename(temp, target)
  lastWrittenSig = sig
}

/** The same export, synchronously, for the moment the app is closing. */
export function exportSyncOnQuit(): void {
  try {
    const folder = loadState().folder
    if (!folder || !existsSync(folder) || !isDatabaseOpen()) return
    const body = snapshotBody()
    if (!body) return
    const sig = signature(body.tracks, body.entries)
    if (sig === lastWrittenSig) return
    const target = join(folder, machineFileName())
    writeFileSync(`${target}.tmp`, serialize(body))
    renameSync(`${target}.tmp`, target)
    lastWrittenSig = sig
  } catch (err) {
    console.error('[sync] export on quit failed:', err)
  }
}

function readBase(remoteId: string): Entries {
  try {
    return JSON.parse(readFileSync(join(baseDir(), `${remoteId}.json`), 'utf8')) as Entries
  } catch {
    return {}
  }
}

function writeBase(remoteId: string, base: Entries): void {
  mkdirSync(baseDir(), { recursive: true })
  writeFileSync(join(baseDir(), `${remoteId}.json`), JSON.stringify(base))
}

/** A full copy of the database, taken right before a merge changes anything, so a
 *  bad merge can always be undone by putting that file back as library.sqlite3. */
async function backupBeforeMerge(): Promise<void> {
  const dir = dirname(getDbPath())
  const file = join(dir, `library-backup-before-sync-${Date.now()}.sqlite3`)
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const old = (await readdir(dir)).filter((f) => f.startsWith('library-backup-before-sync-')).sort().reverse()
  for (const name of old.slice(BACKUPS_TO_KEEP)) await unlink(join(dir, name)).catch(() => undefined)
}

async function importRemotes(folder: string, onlyIfChanged: boolean): Promise<number> {
  const own = machineFileName()
  const files = (await readdir(folder)).filter((f) => f.toLowerCase().endsWith('.json') && f !== own)
  let total = 0

  for (const file of files) {
    const full = join(folder, file)
    let signatureOfFile: string
    let remote: SyncSnapshot | null
    try {
      const st = await stat(full)
      signatureOfFile = `${st.mtimeMs}:${st.size}`
      if (onlyIfChanged && lastSeenRemote.get(file) === signatureOfFile) continue
      remote = parseSnapshot(await readFile(full, 'utf8'))
    } catch {
      continue
    }
    // Still downloading, damaged, or not one of ours: look again next time.
    if (!remote || remote.machineId === loadState().machineId) continue
    if (remote.tracks.length === 0 && Object.keys(remote.entries).length === 0) {
      lastSeenRemote.set(file, signatureOfFile)
      continue
    }

    await waitForDb()
    const base = readBase(remote.machineId)
    const local = buildLocalSnapshot()
    const merged = mergeEntries({
      local: local.entries,
      remote: remote.entries,
      base,
      localTracks: local.tracks,
      remoteTracks: new Set(remote.tracks),
      preferRemote: preferRemoteMachine(loadState(), { startedAt: remote.startedAt ?? Date.now(), machineId: remote.machineId })
    })

    let changes = 0
    let deletions = 0
    for (const key of Object.keys(merged)) if (local.entries[key] !== merged[key]) changes++
    for (const key of Object.keys(local.entries)) {
      if (merged[key] === undefined) {
        changes++
        deletions++
      }
    }

    if (deletions > MASS_DELETE_MIN && deletions > Object.keys(local.entries).length * MASS_DELETE_FRACTION) {
      throw new Error(
        `Another computer's sync file (${remote.machineName}) would remove ${deletions} items here, which looks wrong, so nothing was changed.`
      )
    }

    if (changes > 0) {
      await backupBeforeMerge()
      applyMerged(local.entries, merged)
      total += changes
    }
    const after = changes > 0 ? buildLocalSnapshot() : local
    writeBase(remote.machineId, nextBase(remote.entries, base, after.entries, after.tracks))
    lastSeenRemote.set(file, signatureOfFile)
  }
  return total
}

async function doSync(reason: Reason): Promise<void> {
  const startedAt = Date.now()
  const folder = await resolveFolder()
  if (!folder) {
    const saved = loadState().folder
    setStatus(
      saved
        ? { state: 'unavailable', folder: saved, message: 'Sync folder not found — is Google Drive connected?' }
        : { state: 'off' }
    )
    return
  }
  if (reason === 'manual' || reason === 'startup') setStatus({ state: 'syncing', folder })

  try {
    let changed = 0
    if (reason !== 'blur') changed = await importRemotes(folder, reason === 'focus')
    await exportOwn(folder)
    setStatus({ state: 'ok', folder, lastSyncAt: Date.now(), changed })
    if (changed > 0) mainWindow?.webContents.send(IpcChannels.databaseRefreshed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    perfLog(`sync (${reason}) failed: ${message}`)
    setStatus({ state: 'error', folder, lastSyncAt: status.lastSyncAt, message })
  }
  const took = Date.now() - startedAt
  if (took > 1500) perfLog(`sync (${reason}) took ${took}ms`)
}

function enqueue(reason: Reason): Promise<void> {
  if (running) {
    // Something changed while a sync was running; run once more right after it.
    rerunReason = rerunReason === 'manual' ? 'manual' : reason
    return running
  }
  running = doSync(reason).finally(() => {
    running = null
    if (rerunReason) {
      const next = rerunReason
      rerunReason = null
      void enqueue(next)
    }
  })
  return running
}

/** Runs a sync soon (debounced per reason). Safe to call as often as is convenient. */
export function requestSync(reason: Reason, delayMs = 2000): void {
  if (!started) return
  const pending = timers.get(reason)
  if (pending) clearTimeout(pending)
  timers.set(
    reason,
    setTimeout(() => {
      timers.delete(reason)
      void enqueue(reason)
    }, delayMs)
  )
}

function commonParent(paths: string[]): string | null {
  if (paths.length === 0) return null
  const parents = new Set(paths.map((p) => dirname(p)))
  return parents.size === 1 ? [...parents][0] : null
}

/** First-time setup (or "sync now" once it's set up), from the sidebar button. */
async function setupOrSyncNow(): Promise<SyncStatus> {
  const current = loadState()
  if (!current.folder) {
    const found = await resolveFolder()
    if (!found) {
      let parent = commonParent(listLibraryRoots().map((r) => r.path))
      if (!parent) {
        const picked = await dialog.showOpenDialog({
          title: 'Choose the cloud folder that holds your music (for example Synced Video Items in Google Drive)',
          properties: ['openDirectory']
        })
        if (picked.canceled || picked.filePaths.length === 0) return status
        parent = picked.filePaths[0]
      }
      const target = join(parent, FOLDER_NAME)
      const createFirst = process.platform === 'win32'
      const answer = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Create sync folder', 'Cancel'],
        defaultId: createFirst ? 0 : 1,
        cancelId: 1,
        message: 'Set up tag syncing?',
        detail:
          `BijouMusic will keep its sync files in:\n${target}\n\n` +
          `Your other computer finds this folder by itself once Google Drive has synced it. ` +
          `If you already set up syncing on another computer, cancel and wait for Google Drive to finish syncing the "${FOLDER_NAME}" folder, then click again.`
      })
      if (answer.response !== 0) return status
      await mkdir(target, { recursive: true })
      current.folder = target
      saveState()
    }
  }
  await enqueue('manual')
  return status
}

export function registerSyncIpc(): void {
  ipcMain.handle(IpcChannels.syncGetStatus, (): SyncStatus => status)
  ipcMain.handle(IpcChannels.syncSetup, (): Promise<SyncStatus> => setupOrSyncNow())
  ipcMain.handle(IpcChannels.syncNow, (): Promise<SyncStatus> => setupOrSyncNow())
}

export function startSync(window: BrowserWindow): void {
  mainWindow = window
  window.on('blur', () => requestSync('blur', 2000))
  window.on('focus', () => requestSync('focus', 2500))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  if (started) return
  started = true
  loadState()
  // Let the first library scan get going before the first sync competes with it.
  requestSync('startup', 10_000)
  setInterval(() => requestSync('interval', 0), INTERVAL_MS)
}

/** Saves a text log the Premiere panel sent into the sync folder, so it can be read
 *  on another computer. Returns where it went, or null when sync isn't set up. */
export async function saveSharedLog(text: string): Promise<string | null> {
  const folder = loadState().folder
  if (!folder || !(await isDir(folder))) return null
  const target = join(folder, 'premiere-panel-log.txt')
  await writeFile(target, `Saved ${new Date().toISOString()} from ${hostname()}

${text}`)
  return target
}
