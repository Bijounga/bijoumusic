import { BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { IpcChannels } from '@shared/ipcChannels'
import type { AutoTagInfo, AutoTagSuggestion } from '@shared/types'
import { getAllSettings, setSetting } from './db/repositories/settingsRepo'
import { findTrackById } from './db/repositories/tracksRepo'
import { addTrackTag, findTagByName } from './db/repositories/tagsRepo'
import { ensureTagByTitle } from './scanner/externalTagsImporter'
import { perfLog } from './perfLog'

// Tags a freshly downloaded (or any) song with the trained model from the Music
// Tagger app (github.com/Zengane/music-tagger). That app's tag_job.py is built to
// be run as a one-off child process: give it a file of paths, read one JSON line
// per song from its output. BijouMusic runs it from wherever the Music Tagger is
// installed — it doesn't carry the model or the Python setup itself.
//
// The result is only ever a proposal: the caller shows it and the user confirms
// before anything is written to the library.

const SETTING_KEY = 'autoTagger.folder'
const JOB_TIMEOUT_MS = 10 * 60 * 1000
const isWin = process.platform === 'win32'

// A proposal for a tag the model isn't sure of is only worth showing when its score
// is at least this close to the level it trusts, and only a few of them.
const NEAR_MISS_RATIO = 0.7
const MAX_NEAR_MISSES = 6

let running: Promise<unknown> | null = null

function pythonIn(folder: string): string {
  return isWin ? join(folder, 'venv', 'Scripts', 'python.exe') : join(folder, 'venv', 'bin', 'python')
}

/** A folder holds a usable Music Tagger when it has the job script, its Python
 *  environment and the trained model. */
function isTaggerFolder(folder: string): boolean {
  return existsSync(join(folder, 'tag_job.py')) && existsSync(pythonIn(folder)) && existsSync(join(folder, 'model', 'tagger.pkl'))
}

function candidateFolders(): string[] {
  const out: string[] = []
  const local = process.env['LOCALAPPDATA']
  if (local) out.push(join(local, 'Programs', 'MusicTagger'), join(local, 'MusicTagger'))
  if (isWin) {
    for (let code = 67; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`
      out.push(join(drive, 'MusicTagger'), join(drive, 'MusicTagger', 'MusicTagger'))
    }
  } else {
    out.push(join(homedir(), 'MusicTagger'), join(homedir(), 'Applications', 'MusicTagger'), '/Applications/MusicTagger')
  }
  return out
}

function findFolder(): string | null {
  const saved = getAllSettings()[SETTING_KEY]
  if (saved && isTaggerFolder(saved)) return saved
  for (const candidate of candidateFolders()) {
    if (isTaggerFolder(candidate)) {
      setSetting(SETTING_KEY, candidate)
      return candidate
    }
  }
  return null
}

interface RawScore {
  tag: string
  score: number
  threshold: number
  zero_shot?: boolean
}

interface TagJobResult {
  selected: string[]
  scores: RawScore[]
  game: string
}

/** Runs tag_job.py on one file and resolves with that file's result. */
async function runTagJob(folder: string, audioPath: string, onProgress: (detail: string) => void): Promise<TagJobResult> {
  const work = await mkdtemp(join(tmpdir(), 'bijoumusic-autotag-'))
  const listFile = join(work, 'paths.txt')
  await writeFile(listFile, audioPath, 'utf8')

  try {
    return await new Promise<TagJobResult>((resolve, reject) => {
      // A Mac app started from the Dock doesn't see the shell's PATH, which is where
      // ffmpeg usually lives.
      const env = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PATH: `${process.env['PATH'] ?? ''}${isWin ? '' : ':/opt/homebrew/bin:/usr/local/bin'}`
      }
      const child = spawn(pythonIn(folder), ['tag_job.py', '--paths-from', listFile], { cwd: folder, env, windowsHide: true })

      let result: TagJobResult | null = null
      let failure: string | null = null
      let buffer = ''
      let stderrTail = ''
      const timer = setTimeout(() => {
        failure = 'The tagger took too long and was stopped.'
        child.kill()
      }, JOB_TIMEOUT_MS)

      const handleLine = (line: string): void => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line)
        } catch {
          return // diagnostic noise, not one of its JSON lines
        }
        if (message.event === 'loading' && typeof message.detail === 'string') onProgress(message.detail)
        else if (message.event === 'ready') onProgress('Tagging…')
        else if (message.event === 'result') {
          result = {
            selected: (message.selected as string[]) ?? [],
            scores: (message.scores as RawScore[]) ?? [],
            game: typeof message.game === 'string' ? message.game : ''
          }
        } else if (message.event === 'error' && typeof message.message === 'string') failure = failure ?? message.message
      }

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, newline).trim())
          buffer = buffer.slice(newline + 1)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-600)
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Could not start the tagger: ${err.message}`))
      })
      child.on('close', () => {
        clearTimeout(timer)
        if (buffer.trim()) handleLine(buffer.trim())
        if (result) resolve(result)
        else {
          if (!failure) perfLog(`auto-tag produced no result; stderr: ${stderrTail}`)
          reject(new Error(failure ?? 'The tagger finished without a result.'))
        }
      })
    })
  } finally {
    void rm(work, { recursive: true, force: true })
  }
}

function toSuggestions(result: TagJobResult): AutoTagSuggestion[] {
  const confident = new Set(result.selected)
  const suggestions: AutoTagSuggestion[] = []
  for (const name of result.selected) {
    const s = result.scores.find((x) => x.tag === name)
    suggestions.push({ name, score: s?.score ?? 1, threshold: s?.threshold ?? 0, confident: true, kind: 'tag' })
  }
  const nearMisses = result.scores
    .filter((s) => !confident.has(s.tag) && s.threshold > 0 && s.score / s.threshold >= NEAR_MISS_RATIO)
    .sort((a, b) => b.score / b.threshold - a.score / a.threshold)
    .slice(0, MAX_NEAR_MISSES)
  for (const s of nearMisses) {
    suggestions.push({ name: s.tag, score: s.score, threshold: s.threshold, confident: false, kind: 'tag' })
  }
  // The game the file name points at, offered only when the library already has a tag for it.
  if (result.game && findTagByName(result.game)) {
    suggestions.push({ name: result.game, score: 1, threshold: 1, confident: false, kind: 'game' })
  }
  return suggestions
}

export function registerAutoTagIpc(): void {
  ipcMain.handle(IpcChannels.autoTagInfo, (): AutoTagInfo => ({ folder: findFolder() }))

  ipcMain.handle(IpcChannels.autoTagPickFolder, async (): Promise<AutoTagInfo> => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose your Music Tagger folder (the one that contains tag_job.py)',
      properties: ['openDirectory']
    })
    if (!picked.canceled && picked.filePaths[0]) {
      const folder = picked.filePaths[0]
      if (!isTaggerFolder(folder)) {
        throw new Error('That folder is missing tag_job.py, its venv or model/tagger.pkl — pick the folder Music Tagger is installed in.')
      }
      setSetting(SETTING_KEY, folder)
    }
    return { folder: findFolder() }
  })

  ipcMain.handle(IpcChannels.autoTagSuggest, async (event, trackId: number): Promise<AutoTagSuggestion[]> => {
    const folder = findFolder()
    if (!folder) throw new Error('Music Tagger was not found.')
    const track = findTrackById(trackId)
    if (!track) throw new Error('That song is not in the library.')
    if (running) throw new Error('The tagger is already busy with another song.')

    const sender = BrowserWindow.fromWebContents(event.sender)
    const job = runTagJob(folder, track.current_path, (detail) => sender?.webContents.send(IpcChannels.autoTagProgress, detail))
    running = job
    try {
      return toSuggestions(await job)
    } finally {
      running = null
    }
  })

  // Applies the tags the user confirmed. Missing ones are created in the same
  // Mood/Sound groups the sidecar import uses.
  ipcMain.handle(IpcChannels.autoTagApply, (_event, trackId: number, names: string[]): void => {
    for (const name of names) {
      const { tag } = ensureTagByTitle(name)
      addTrackTag(trackId, tag.id)
    }
  })
}
