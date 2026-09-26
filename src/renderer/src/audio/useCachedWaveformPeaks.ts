import { useEffect, useState } from 'react'
import type { Track } from '@shared/types'

// Shared with useWaveformPeaks' cache would be ideal, but this hook intentionally
// never generates — it's used per visible row, and generation (full audio decode)
// for every track scrolled past would be a real perf problem. Rows only ever show a
// waveform once it's been generated some other way (selecting the track), and this
// cache just avoids re-fetching from disk on every scroll-into-view.
const memoryCache = new Map<string, Float32Array | null>()

export function useCachedWaveformPeaks(track: Track): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(() => memoryCache.get(track.contentHash) ?? null)

  useEffect(() => {
    const cached = memoryCache.get(track.contentHash)
    if (cached !== undefined) {
      setPeaks(cached)
      return
    }

    let cancelled = false
    window.api.getWaveformPeaks(track.contentHash).then((result) => {
      if (cancelled) return
      memoryCache.set(track.contentHash, result)
      setPeaks(result)
    })

    return () => {
      cancelled = true
    }
  }, [track.contentHash])

  return peaks
}
