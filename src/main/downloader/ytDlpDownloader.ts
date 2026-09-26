import { app } from 'electron'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import * as YTDlpWrapModule from 'yt-dlp-wrap-plus'

// yt-dlp-wrap-plus's compiled output isn't marked as an ES module, so exactly
// how many levels of `.default` the bundler's CJS interop leaves in place is
// unreliable — probe for the real class (has a `downloadFromGithub` static)
// rather than assume a fixed unwrap depth.
function unwrapYTDlpWrap(candidate: unknown, depth = 0): typeof YTDlpWrapModule.default {
  const c = candidate as { downloadFromGithub?: unknown; default?: unknown }
  if (typeof c?.downloadFromGithub === 'function') return c as typeof YTDlpWrapModule.default
  if (depth < 3 && c?.default) return unwrapYTDlpWrap(c.default, depth + 1)
  throw new Error('Could not resolve the yt-dlp-wrap-plus class export')
}
const YTDlpWrap = unwrapYTDlpWrap(YTDlpWrapModule)

const BIN_DIR = join(app.getPath('userData'), 'bin')
const YT_DLP_PATH = join(BIN_DIR, 'yt-dlp.exe')

// Unlike premiere.ipc.ts's ffmpeg lookup (which spawns the resolved candidate
// directly, so a bare "ffmpeg" works fine via PATH resolution), this value is
// handed to yt-dlp's --ffmpeg-location flag, which yt-dlp validates with its
// own file-existence check — a bare command name always fails that check and,
// once given an explicit (bad) location, yt-dlp does NOT fall back to
// searching PATH itself, so postprocessing (mp3 extraction) fails outright.
// Only ever return a real, existsSync-verified absolute path; when ffmpeg is
// merely on PATH with no known absolute fallback, omit the flag entirely so
// yt-dlp does its own PATH search, which works correctly on its own.
const FFMPEG_ABSOLUTE_FALLBACK = 'C:\\ffmpeg\\bin\\ffmpeg.exe'

function resolveFfmpegLocationArg(): string | null {
  return existsSync(FFMPEG_ABSOLUTE_FALLBACK) ? FFMPEG_ABSOLUTE_FALLBACK : null
}

/** Downloads the yt-dlp binary once into userData on first use — after that,
 *  every call just points at the already-downloaded copy. Keeps this app from
 *  needing to bundle/ship the binary itself. */
async function ensureYtDlpBinary(onProgress?: (percent: number) => void): Promise<string> {
  if (existsSync(YT_DLP_PATH)) return YT_DLP_PATH
  await mkdir(BIN_DIR, { recursive: true })
  await YTDlpWrap.downloadFromGithub(YT_DLP_PATH, undefined, 'win32', (percent: number) => {
    onProgress?.(percent)
  })
  return YT_DLP_PATH
}

export interface VideoInfo {
  thumbnail: string | null
  title: string | null
}

/** Looks up a URL's metadata (title, thumbnail) without downloading anything —
 *  used to show a thumbnail preview in the Download modal as soon as a URL is
 *  pasted in, so there's no need to actually start a download just to see
 *  whether the source has usable cover art. Fetches the thumbnail itself and
 *  returns it as a data: URL rather than the remote URL directly — the
 *  renderer's CSP only allows 'self'/data:/app-audio: image sources, same as
 *  how embedded cover art already works via albumArtCache. */
export async function getVideoThumbnail(url: string): Promise<VideoInfo> {
  const binaryPath = await ensureYtDlpBinary()
  const ytDlpWrap = new YTDlpWrap(binaryPath)
  const info = await ytDlpWrap.getVideoInfo([url, '--no-playlist'])
  const title = typeof info?.title === 'string' ? info.title : null
  const remoteThumbnailUrl = typeof info?.thumbnail === 'string' ? info.thumbnail : null
  if (!remoteThumbnailUrl) return { thumbnail: null, title }

  try {
    const response = await fetch(remoteThumbnailUrl)
    if (!response.ok) return { thumbnail: null, title }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    const buffer = Buffer.from(await response.arrayBuffer())
    return { thumbnail: `data:${contentType};base64,${buffer.toString('base64')}`, title }
  } catch {
    return { thumbnail: null, title }
  }
}

export interface DownloadProgress {
  stage: 'preparing' | 'downloading'
  percent?: number
  speed?: string
  eta?: string
}

export interface DownloadOutcome {
  filePath: string
}

/** Downloads a URL's audio straight into destFolder via yt-dlp + ffmpeg, and
 *  resolves with the path of the file that actually landed there. Uses yt-dlp's
 *  own `--print after_move:filepath` to report the final (post-extraction)
 *  path directly, rather than diffing the folder's contents before/after —
 *  a diff misses the case where yt-dlp finds the target file already exists
 *  (e.g. the same URL downloaded before) and skips re-downloading it: yt-dlp
 *  still exits 0 and the file is genuinely there, but no *new* file appears. */
export async function downloadAudioToFolder(
  url: string,
  destFolder: string,
  embedThumbnail: boolean,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadOutcome> {
  onProgress({ stage: 'preparing' })
  const binaryPath = await ensureYtDlpBinary()
  const ffmpegPath = resolveFfmpegLocationArg()
  await mkdir(destFolder, { recursive: true })

  const ytDlpWrap = new YTDlpWrap(binaryPath)
  const args = [
    url,
    '-x',
    '--audio-format',
    'mp3',
    '--no-playlist',
    '-o',
    join(destFolder, '%(title)s.%(ext)s'),
    '--print',
    'after_move:filepath'
  ]
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath)
  if (embedThumbnail) args.push('--embed-thumbnail')

  let stdout = ''
  await new Promise<void>((resolve, reject) => {
    const emitter = ytDlpWrap.exec(args)
    emitter.ytDlpProcess?.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    emitter.on('progress', (progress: { percent?: number; currentSpeed?: string; eta?: string }) => {
      onProgress({ stage: 'downloading', percent: progress.percent, speed: progress.currentSpeed, eta: progress.eta })
    })
    emitter.on('error', (err: Error) => reject(err))
    emitter.on('close', (code: number | null) => {
      if (code === 0) resolve()
      else reject(new Error(`yt-dlp exited with code ${code}`))
    })
  })

  // Every other line yt-dlp writes to stdout (progress, [ExtractAudio], etc.)
  // starts with "[" — the --print output is the one plain line, and
  // after_move:filepath only ever prints once per downloaded item.
  const printedLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('['))
  const filePath = printedLines[printedLines.length - 1]
  if (!filePath) throw new Error('yt-dlp finished but did not report the output file path')

  return { filePath }
}
