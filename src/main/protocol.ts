import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { findTrackById } from './db/repositories/tracksRepo'

const SCHEME = 'app-audio'

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
}

/** Must run before app.whenReady() — privileged scheme registration is only honored pre-ready. */
export function registerAudioProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
    }
  ])
}

/**
 * Serves each track's real file with manual HTTP range support. net.fetch(file://...)
 * doesn't come with Content-Length/Accept-Ranges for local files, which leaves the
 * <audio> element unable to determine duration or seek — so range handling is done
 * by hand here via fs.createReadStream instead.
 */
export function registerAudioProtocolHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    // Host must be non-numeric: a purely-numeric host (e.g. "9") gets silently
    // rewritten by the URL parser into IPv4 dotted-quad form ("0.0.0.9"), which then
    // fails to parse back as a track id — hence the "t" prefix.
    const host = new URL(request.url).hostname
    const trackId = host.startsWith('t') ? Number(host.slice(1)) : NaN
    const track = Number.isFinite(trackId) ? findTrackById(trackId) : undefined
    if (!track) {
      return new Response('Track not found', { status: 404 })
    }

    let fileSize: number
    try {
      fileSize = (await stat(track.current_path)).size
    } catch {
      return new Response('File not found on disk', { status: 404 })
    }

    const contentType = MIME_TYPES[track.extension] ?? 'application/octet-stream'
    const rangeHeader = request.headers.get('range')

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
      const start = match ? Number(match[1]) : 0
      const end = match?.[2] ? Number(match[2]) : fileSize - 1
      const chunkSize = end - start + 1

      const stream = createReadStream(track.current_path, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize)
        }
      })
    }

    const stream = createReadStream(track.current_path)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(fileSize)
      }
    })
  })
}
