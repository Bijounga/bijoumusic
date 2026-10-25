import { useEffect, useState } from 'react'
import type { Track } from '@shared/types'
import { generateWaveformPeaks } from './generateWaveformPeaks'
import { useLibraryStore } from '../state/libraryStore'
import { LruCache } from '../lib/lruCache'
import { ensureBpm } from './ensureBpm'

// In-memory cache on top of the on-disk one, keyed by content hash — reselecting a
// track already viewed this session skips even the IPC round-trip.
const memoryCache = new LruCache<string, Float32Array>(60)

interface WaveformState {
  peaks: Float32Array | null
  isLoading: boolean
  failed: boolean
}

export function useWaveformPeaks(track: Track | null): WaveformState {
  const setTrackDuration = useLibraryStore((s) => s.setTrackDuration)
  const setTrackLoudness = useLibraryStore((s) => s.setTrackLoudness)
  const setTrackBpm = useLibraryStore((s) => s.setTrackBpm)
  const [state, setState] = useState<WaveformState>({ peaks: null, isLoading: false, failed: false })

  useEffect(() => {
    if (!track) {
      setState({ peaks: null, isLoading: false, failed: false })
      return
    }

    void ensureBpm(track)

    const cached = memoryCache.get(track.contentHash)
    if (cached) {
      setState({ peaks: cached, isLoading: false, failed: false })
      return
    }

    let cancelled = false
    setState({ peaks: null, isLoading: true, failed: false })

    async function load(): Promise<void> {
      const fromDisk = await window.api.getWaveformPeaks(track!.contentHash)
      if (cancelled) return

      if (fromDisk) {
        memoryCache.set(track!.contentHash, fromDisk)
        setState({ peaks: fromDisk, isLoading: false, failed: false })
        return
      }

      try {
        const { peaks, durationSeconds, rms, bpm } = await generateWaveformPeaks(track!.id)
        if (cancelled) return

        memoryCache.set(track!.contentHash, peaks)
        setState({ peaks, isLoading: false, failed: false })
        void window.api.saveWaveformPeaks(track!.contentHash, peaks)
        if (track!.durationSeconds === null) {
          void window.api.updateTrackDuration(track!.id, durationSeconds)
          setTrackDuration(track!.id, durationSeconds)
        }
        void window.api.updateTrackLoudness(track!.id, rms)
        setTrackLoudness(track!.id, rms)
        if (bpm !== null) {
          void window.api.updateTrackBpm(track!.id, bpm)
          setTrackBpm(track!.id, bpm)
        }
      } catch {
        // A corrupt or unsupported file shouldn't leave the panel spinning forever.
        if (!cancelled) setState({ peaks: null, isLoading: false, failed: true })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [track, setTrackDuration, setTrackLoudness, setTrackBpm])

  return state
}
