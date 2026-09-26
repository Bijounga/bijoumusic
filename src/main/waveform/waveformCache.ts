import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

function cacheDir(): string {
  return join(app.getPath('userData'), 'waveform-cache')
}

// Cached by content hash (not track id/path) so a moved or renamed file still hits
// its cache — only genuinely changed bytes invalidate it.
function cachePath(contentHash: string): string {
  return join(cacheDir(), `${contentHash}.peaks`)
}

export async function readCachedPeaks(contentHash: string): Promise<Float32Array | null> {
  try {
    const buf = await readFile(cachePath(contentHash))
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT)
  } catch {
    return null
  }
}

export async function writeCachedPeaks(contentHash: string, peaks: Float32Array): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(cachePath(contentHash), Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength))
}
