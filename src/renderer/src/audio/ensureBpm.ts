import type { Track } from '@shared/types'
import { useLibraryStore } from '../state/libraryStore'
import { detectTrackBpm } from './generateWaveformPeaks'

const MIN_SECONDS_FOR_BPM = 12
const inFlight = new Set<number>()

/** Works out a song's tempo right away if it isn't known yet - used for the song that's
 *  playing, so its BPM shows now instead of whenever the background pass reaches it. */
export async function ensureBpm(track: Track): Promise<void> {
  const known = useLibraryStore.getState().tracks.find((t) => t.id === track.id)
  if (!known || known.bpm !== null || inFlight.has(track.id)) return
  inFlight.add(track.id)
  try {
    let bpm = 0
    if (known.durationSeconds === null || known.durationSeconds >= MIN_SECONDS_FOR_BPM) {
      const found = await detectTrackBpm(track.id)
      if (found === null) return
      bpm = found
    }
    void window.api.updateTrackBpm(track.id, bpm)
    useLibraryStore.getState().setTrackBpm(track.id, bpm)
  } catch {
    // Unreadable file: the background pass will try again later.
  } finally {
    inFlight.delete(track.id)
  }
}
