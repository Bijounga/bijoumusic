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

export interface PlaylistSummary {
  title: string | null
  count: number | null
}

/** Asks yt-dlp what a playlist URL holds (its name and how many songs) without
 *  fetching each song's details - --flat-playlist keeps this to one quick request. */
export async function getPlaylistSummary(url: string): Promise<PlaylistSummary> {
  const binaryPath = await ensureYtDlpBinary()
  const ytDlpWrap = new YTDlpWrap(binaryPath)
  const raw = await ytDlpWrap.execPromise([url, '--flat-playlist', '--dump-single-json', '--yes-playlist'])
  const info = JSON.parse(raw) as { title?: unknown; entries?: unknown[] }
  return {
    title: typeof info.title === 'string' ? info.title : null,
    count: Array.isArray(info.entries) ? info.entries.length : null
  }
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
  const info = await ytDlpWrap.getVideoInfo([url, '--no-playlist', '--flat-playlist'])
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

/** yt-dlp's failure message is its whole stderr, mostly warnings; the ERROR lines are
 *  the part worth showing. */
function readableFailure(err: Error): Error {
  const errors = err.message
    .split(/\r?\n/)
    .filter((line) => line.startsWith('ERROR:'))
    .map((line) => line.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?/, ''))
  return errors.length > 0 ? new Error(errors.slice(0, 3).join('\n')) : err
}

export interface DownloadProgress {
  stage: 'preparing' | 'downloading'
  item?: number
  total?: number
  percent?: number
  speed?: string
  eta?: string
}

export interface DownloadOutcome {
  /** The last file written (the only one, for a single video). */
  filePath: string
  /** Every file written - several for a playlist. */
  filePaths: string[]
  /** Playlist songs that couldn't be downloaded (private, removed, blocked...). */
  failed: number
}

export interface DownloadOptions {
  /** Download every song of a playlist URL rather than just the one video. */
  playlist?: boolean
  /** With a playlist: a new folder named after it holds the songs. */
  playlistFolder?: boolean
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
  onProgress: (progress: DownloadProgress) => void,
  options: DownloadOptions = {}
): Promise<DownloadOutcome> {
  onProgress({ stage: 'preparing' })
  const binaryPath = await ensureYtDlpBinary()
  const ffmpegPath = resolveFfmpegLocationArg()
  await mkdir(destFolder, { recursive: true })

  const ytDlpWrap = new YTDlpWrap(binaryPath)
  const playlist = options.playlist === true
  const template =
    playlist && options.playlistFolder ? '%(playlist_title|Playlist)s/%(title)s.%(ext)s' : '%(title)s.%(ext)s'
  const args = [
    url,
    '-x',
    '--audio-format',
    'mp3',
    // One song that can't be fetched shouldn't end a whole playlist.
    ...(playlist ? ['--yes-playlist', '--ignore-errors'] : ['--no-playlist']),
    '-o',
    join(destFolder, template),
    '--print',
    'after_move:filepath',
    // --print also silences yt-dlp's own "Downloading item 3 of 20" line, so ask for it.
    '--print',
    'before_dl:@@item %(playlist_index)s %(n_entries)s'
  ]
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath)
  if (embedThumbnail) args.push('--embed-thumbnail')

  let stdout = ''
  // Playlists: each song announces itself with the "@@item 3 20" line asked for above.
  let item: number | undefined
  let total: number | undefined
  // yt-dlp-wrap reports a non-zero exit (which a playlist with a few unavailable videos
  // always ends with) as an 'error' event carrying the whole stderr, not as 'close'.
  let failure: Error | null = null
  const exitCode = await new Promise<number | null>((resolve) => {
    const emitter = ytDlpWrap.exec(args)
    emitter.ytDlpProcess?.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      const match = /@@item (\d+) (\d+)/.exec(text)
      if (match) {
        item = Number(match[1])
        total = Number(match[2])
        onProgress({ stage: 'downloading', item, total, percent: 0 })
      }
    })
    emitter.on('progress', (progress: { percent?: number; currentSpeed?: string; eta?: string }) => {
      onProgress({ stage: 'downloading', item, total, percent: progress.percent, speed: progress.currentSpeed, eta: progress.eta })
    })
    emitter.on('error', (err: Error) => {
      failure = err
      resolve(1)
    })
    emitter.on('close', (code: number | null) => resolve(code))
  })

  // Every other line yt-dlp writes to stdout (progress, [ExtractAudio], etc.)
  // starts with "[" — the --print output is the one plain line, and
  // after_move:filepath only ever prints once per downloaded item.
  const printedLines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith('@@item'))
  const filePath = printedLines[printedLines.length - 1]
  // A playlist with some unavailable songs still ends with a non-zero code; that's only
  // a failure when nothing at all came down.
  if (exitCode !== 0 && !(playlist && filePath)) throw failure ? readableFailure(failure) : new Error(`yt-dlp exited with code ${exitCode}`)
  if (!filePath) throw new Error('yt-dlp finished but did not report the output file path')

  const failed = playlist && total !== undefined ? Math.max(0, total - printedLines.length) : 0
  return { filePath, filePaths: printedLines, failed }
}
