import { createHash } from 'crypto'
import { open } from 'fs/promises'

const CHUNK_SIZE = 64 * 1024

/**
 * Cheap content identity: hashes the first/last 64KB + file size rather than the
 * whole file, so large WAVs don't get fully re-read on every rescan. Collision risk
 * is negligible for a personal library; a full-hash fallback can be added later if needed.
 */
export async function computePartialHash(filePath: string, fileSize: number): Promise<string> {
  const hash = createHash('sha256')
  hash.update(String(fileSize))

  const handle = await open(filePath, 'r')
  try {
    const headBuf = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize))
    await handle.read(headBuf, 0, headBuf.length, 0)
    hash.update(headBuf)

    if (fileSize > CHUNK_SIZE) {
      const tailSize = Math.min(CHUNK_SIZE, fileSize)
      const tailBuf = Buffer.alloc(tailSize)
      await handle.read(tailBuf, 0, tailSize, fileSize - tailSize)
      hash.update(tailBuf)
    }
  } finally {
    await handle.close()
  }

  return hash.digest('hex')
}
