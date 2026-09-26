import { app } from 'electron'
import { join } from 'path'
import { access, readFile, writeFile, mkdir } from 'fs/promises'
import { constants } from 'fs'
import { findTrackById } from '../db/repositories/tracksRepo'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

function cacheDir(): string {
  return join(app.getPath('userData'), 'album-art-cache')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Reads embedded cover art from a track's file (ID3/etc via music-metadata),
 * caching the result to disk keyed by content hash — including a ".none" marker
 * for tracks with no art, so those aren't re-parsed on every request. Returns a
 * data: URL directly rather than a custom protocol since art is small and doesn't
 * need streaming/range support the way audio does.
 */
export async function getAlbumArtDataUrl(trackId: number): Promise<string | null> {
  const track = findTrackById(trackId)
  if (!track) return null

  await mkdir(cacheDir(), { recursive: true })

  const noneMarkerPath = join(cacheDir(), `${track.content_hash}.none`)
  if (await pathExists(noneMarkerPath)) return null

  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const cachedPath = join(cacheDir(), `${track.content_hash}.${ext}`)
    if (await pathExists(cachedPath)) {
      const buf = await readFile(cachedPath)
      return `data:${mime};base64,${buf.toString('base64')}`
    }
  }

  try {
    // ESM-only package — dynamic import works from this CJS-built main bundle,
    // a static import would fail to require() it.
    const mm = await import('music-metadata')
    const metadata = await mm.parseFile(track.current_path)
    const picture = metadata.common.picture?.[0]
    if (!picture) {
      await writeFile(noneMarkerPath, '')
      return null
    }

    const ext = MIME_EXT[picture.format] ?? 'jpg'
    const cachePath = join(cacheDir(), `${track.content_hash}.${ext}`)
    const buffer = Buffer.from(picture.data)
    await writeFile(cachePath, buffer)
    return `data:${picture.format};base64,${buffer.toString('base64')}`
  } catch {
    await writeFile(noneMarkerPath, '')
    return null
  }
}
