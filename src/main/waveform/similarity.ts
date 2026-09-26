import { readCachedPeaks } from './waveformCache'

const FINGERPRINT_BUCKETS = 48
const MAX_RESULTS = 20

/** Downsamples a track's cached min/max peaks into a small, loudness-normalized
 *  envelope — a rough proxy for a track's dynamic "shape" (where it's
 *  loud/quiet/builds/drops), not its timbre or genre. Two tracks with similar
 *  fingerprints have similar energy contours over time, not necessarily similar
 *  instrumentation — this is a pragmatic approximation built on data already
 *  computed for the waveform display, not real audio content analysis. */
function toFingerprint(peaks: Float32Array): number[] {
  const bucketCount = peaks.length / 2
  const groupSize = Math.max(1, Math.floor(bucketCount / FINGERPRINT_BUCKETS))
  const fingerprint: number[] = []

  for (let i = 0; i < FINGERPRINT_BUCKETS; i++) {
    const start = i * groupSize
    const end = Math.min(start + groupSize, bucketCount)
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += peaks[j * 2 + 1] - peaks[j * 2]
      count++
    }
    fingerprint.push(count > 0 ? sum / count : 0)
  }

  const max = Math.max(...fingerprint, 1e-6)
  return fingerprint.map((v) => v / max)
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

export interface SimilarityCandidate {
  trackId: number
  contentHash: string
}

export async function findSimilarByFingerprint(
  targetContentHash: string,
  candidates: SimilarityCandidate[]
): Promise<{ trackId: number; distance: number }[]> {
  const targetPeaks = await readCachedPeaks(targetContentHash)
  if (!targetPeaks) return []
  const targetFingerprint = toFingerprint(targetPeaks)

  // A real library runs into the thousands of candidates — reading them one at a
  // time in sequence took several seconds. The reads are independent disk I/O, so
  // running them concurrently instead brings this down to a fraction of a second.
  const withDistance = await Promise.all(
    candidates
      .filter((c) => c.contentHash !== targetContentHash)
      .map(async (candidate) => {
        const peaks = await readCachedPeaks(candidate.contentHash)
        if (!peaks) return null
        return { trackId: candidate.trackId, distance: euclideanDistance(targetFingerprint, toFingerprint(peaks)) }
      })
  )

  const results = withDistance.filter((r): r is { trackId: number; distance: number } => r !== null)
  results.sort((a, b) => a.distance - b.distance)
  return results.slice(0, MAX_RESULTS)
}
