import { create } from 'zustand'
import type { Track } from '@shared/types'

interface SimilarityState {
  sourceTrack: Track | null
  resultTrackIds: number[]
  isSearching: boolean
  /** A rough "similar dynamics" search over cached waveforms — not real audio
   *  content analysis, so results are approximate at best. Only tracks that
   *  already have a cached waveform are eligible candidates. */
  findSimilar: (track: Track, allTracks: Track[]) => Promise<void>
}

export const useSimilarityStore = create<SimilarityState>((set) => ({
  sourceTrack: null,
  resultTrackIds: [],
  isSearching: false,

  findSimilar: async (track, allTracks) => {
    set({ sourceTrack: track, resultTrackIds: [], isSearching: true })
    const candidates = allTracks
      .filter((t) => t.id !== track.id)
      .map((t) => ({ trackId: t.id, contentHash: t.contentHash }))
    const results = await window.api.findSimilarTracks(track.contentHash, candidates)
    set({ resultTrackIds: results.map((r) => r.trackId), isSearching: false })
  }
}))
