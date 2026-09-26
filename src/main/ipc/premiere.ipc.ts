import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { IpcChannels } from '@shared/ipcChannels'
import type { SendToPremierePayload, PremiereAnalyzeResult } from '@shared/types'
import {
  pingPremiere,
  isPremiereConnected,
  onPremiereStatusChange,
  sendPremiereRequest,
  setIncomingRequestHandler,
  type BridgeResponse
} from '../premiereBridge'

const TEMP_AUDIO_DIR = join(app.getPath('temp'), 'bijoumusic-premiere')

// Generous — decoding + analyzing a longer SFX/music file in the renderer can
// take a moment, and this is a background tool action, not a keystroke.
const ANALYZE_TIMEOUT_MS = 20000

// A source recording can run multiple hours (e.g. a full voiceover/podcast
// session) while the actual range being analyzed is usually a small fraction
// of that. Without this, analyzeClip() read the ENTIRE file, shipped all of
// it across IPC, and decoded all of it in the renderer regardless of range —
// for a multi-hour uncompressed recording that's a multi-GB memory spike for
// analyzing a few minutes. extractRangeToTempFile() uses ffmpeg to cut just
// the needed (padded) range into a small temp file first, so cost scales with
// the range being analyzed, not the source file's total length.
const EXTRACT_PADDING_SECONDS = 1
const FFMPEG_CANDIDATES = ['ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe']

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
    })
  })
}

interface ExtractedRange {
  tempPath: string
  /** Seconds to add back to any time value the analysis returns, to convert
   *  it from "relative to the extracted temp file" back to "relative to the
   *  original source file." */
  offsetSeconds: number
}

/** Extracts [start - padding, end + padding] from filePath into a small temp
 *  WAV via ffmpeg. Seeks on the INPUT side (-ss before -i) rather than the
 *  output side — for a multi-hour file, output-side seeking would still
 *  decode from the start to reach the target position, defeating the point.
 *  Tries a couple of likely ffmpeg locations since it may not be on PATH. */
async function extractRangeToTempFile(filePath: string, start: number, end: number): Promise<ExtractedRange> {
  const offsetSeconds = Math.max(0, start - EXTRACT_PADDING_SECONDS)
  const duration = end - offsetSeconds + EXTRACT_PADDING_SECONDS
  const tempPath = join(app.getPath('temp'), `bijoumusic-analyze-${randomUUID()}.wav`)
  const args = [
    '-y',
    '-ss',
    String(offsetSeconds),
    '-i',
    filePath,
    '-t',
    String(duration),
    '-vn',
    '-c:a',
    'pcm_s16le',
    tempPath
  ]

  let lastError: unknown
  for (const candidate of FFMPEG_CANDIDATES) {
    try {
      await runFfmpeg(candidate, args)
      return { tempPath, offsetSeconds }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function rebaseAnalyzeResult(result: PremiereAnalyzeResult, offsetSeconds: number): PremiereAnalyzeResult {
  if (offsetSeconds === 0 || result.mode !== 'silence') return result
  return {
    mode: 'silence',
    result: {
      segments: result.result.segments.map((segment) => ({
        start: segment.start + offsetSeconds,
        end: segment.end + offsetSeconds
      }))
    }
  }
}

interface PendingAnalysis {
  resolve: (result: PremiereAnalyzeResult) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}
const pendingAnalysis = new Map<string, PendingAnalysis>()

/** Reads the file main-side (so the renderer never needs filesystem/protocol
 *  access to an arbitrary path outside BijouMusic's own library — this could
 *  be any file already sitting on a Premiere timeline), forwards it to a
 *  renderer window for the actual decode/analysis (decodeAudioData only exists
 *  there), and waits for the answer via premiereAnalyzeResponse. */
interface AnalyzeClipOptions {
  filePath: string
  mode: 'silence' | 'lufs'
  targetLufs?: number
  searchStart?: number
  searchEnd?: number
  thresholdDb?: number
  minSilenceSeconds?: number
}

async function analyzeClip(options: AnalyzeClipOptions): Promise<PremiereAnalyzeResult> {
  let filePathToRead = options.filePath
  let offsetSeconds = 0
  let tempPath: string | null = null

  if (typeof options.searchStart === 'number' && typeof options.searchEnd === 'number') {
    try {
      const extracted = await extractRangeToTempFile(options.filePath, options.searchStart, options.searchEnd)
      tempPath = extracted.tempPath
      filePathToRead = extracted.tempPath
      offsetSeconds = extracted.offsetSeconds
    } catch (err) {
      // ffmpeg missing or failed — fall back to reading the whole file rather
      // than failing the analysis outright. Slower/heavier for a long source,
      // but still correct.
      console.error('[premiere.ipc] range extraction failed, falling back to full file read:', err)
    }
  }

  try {
    const bytes = await readFile(filePathToRead)
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('BijouMusic window is not available')

    const requestId = randomUUID()
    const result = await new Promise<PremiereAnalyzeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingAnalysis.delete(requestId)
        reject(new Error('Analysis timed out'))
      }, ANALYZE_TIMEOUT_MS)
      pendingAnalysis.set(requestId, { resolve, reject, timeout })
      window.webContents.send(IpcChannels.premiereAnalyzeRequest, {
        requestId,
        mode: options.mode,
        bytes: new Uint8Array(bytes),
        targetLufs: options.targetLufs,
        // Rebased to the extracted temp file's own zero point when extraction
        // happened — the renderer never needs to know the original file existed.
        searchStart: options.searchStart !== undefined ? options.searchStart - offsetSeconds : undefined,
        searchEnd: options.searchEnd !== undefined ? options.searchEnd - offsetSeconds : undefined,
        thresholdDb: options.thresholdDb,
        minSilenceSeconds: options.minSilenceSeconds
      })
    })

    return rebaseAnalyzeResult(result, offsetSeconds)
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {})
  }
}

export function registerPremiereIpc(): void {
  ipcMain.handle(IpcChannels.premierePing, (): Promise<boolean> => pingPremiere())

  ipcMain.handle(IpcChannels.premiereGetStatus, (): boolean => isPremiereConnected())

  onPremiereStatusChange((connected) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcChannels.premiereStatusChanged, connected)
    }
  })

  // The renderer calls this back once it's finished decoding/analyzing audio
  // that analyzeClip() sent it — correlated by requestId, same pattern as
  // sendPremiereRequest's own pending map.
  ipcMain.handle(
    IpcChannels.premiereAnalyzeResponse,
    (_event, requestId: string, result: PremiereAnalyzeResult | null, error?: string): void => {
      const pendingRequest = pendingAnalysis.get(requestId)
      if (!pendingRequest) return
      clearTimeout(pendingRequest.timeout)
      pendingAnalysis.delete(requestId)
      if (error || !result) pendingRequest.reject(new Error(error ?? 'Analysis failed'))
      else pendingRequest.resolve(result)
    }
  )

  // Requests the extension itself initiates (silence-trim/LUFS tools) rather
  // than ones BijouMusic sent and is awaiting a reply to.
  setIncomingRequestHandler(async (message: BridgeResponse) => {
    if (message.type === 'analyze-clip') {
      const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)
      const analysis = await analyzeClip({
        filePath: String(message.filePath),
        mode: message.mode as 'silence' | 'lufs',
        targetLufs: asNumber(message.targetLufs),
        searchStart: asNumber(message.searchStart),
        searchEnd: asNumber(message.searchEnd),
        thresholdDb: asNumber(message.thresholdDb),
        minSilenceSeconds: asNumber(message.minSilenceSeconds)
      })
      return { type: 'analyze-result', ...analysis }
    }
    throw new Error(`Unknown incoming request: ${message.type}`)
  })

  // A stable filename per track (not a fresh temp name each time) so a repeated
  // send just overwrites the previous attempt rather than littering the temp
  // folder with one file per drag.
  ipcMain.handle(
    IpcChannels.premiereSaveTempAudio,
    async (_event, trackId: number, bytes: Uint8Array): Promise<string> => {
      await mkdir(TEMP_AUDIO_DIR, { recursive: true })
      const filePath = join(TEMP_AUDIO_DIR, `track-${trackId}-preview.wav`)
      await writeFile(filePath, bytes)
      return filePath
    }
  )

  // Button flow: the extension does the whole thing — import, insert/overwrite
  // onto the sequence, then (if a trim range was given) swap in the original file
  // and fix the clip's in/out to match.
  ipcMain.handle(
    IpcChannels.premiereSendTrack,
    async (_event, payload: SendToPremierePayload): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await sendPremiereRequest({ type: 'send-track', ...payload })
        if (response.type === 'error') {
          return { success: false, error: String(response.error ?? 'Unknown error') }
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Drag flow: the user places the temp file themselves via native OS drag, so
  // there's no placement command to send — just a heads-up so the extension knows
  // to watch for that specific temp file landing and perform the same swap
  // afterward. Fire-and-forget from the renderer's perspective (dragstart can't
  // wait on a round trip), but still resolves/rejects here so a disconnected
  // extension can be surfaced rather than silently dragging a stub file that never
  // gets swapped.
  ipcMain.handle(
    IpcChannels.premiereExpectDrop,
    async (_event, payload: SendToPremierePayload): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await sendPremiereRequest({ type: 'expect-drop', ...payload })
        if (response.type === 'error') {
          return { success: false, error: String(response.error ?? 'Unknown error') }
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
