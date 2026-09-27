import type { Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useShuffleStore } from '../state/shuffleStore'

// Past this point into a track, Back restarts it; before it, Back goes to the
// previous track — the usual music-player rule. A quick double-press still goes
// back, since the first press lands at 0:00, inside the threshold.
const RESTART_THRESHOLD_SECONDS = 3

interface TransportControls {
  next: () => void
  previous: () => void
  hasNext: boolean
}

/** Shared next/previous logic for the bottom bar buttons, media keys, and
 *  autoplay. Next steps through the same `visibleTracks` list TrackList renders
 *  (or picks randomly in shuffle mode); Previous retraces actual listening
 *  history from the playback store, so it returns to the track you really came
 *  from — after a random pick, a shuffle step, or clicking around the list. */
export function useTransportControls(visibleTracks: Track[]): TransportControls {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const playTrack = usePlaybackStore((s) => s.playTrack)
  const playPreviousFromHistory = usePlaybackStore((s) => s.playPreviousFromHistory)
  const seek = usePlaybackStore((s) => s.seek)
  const shuffleEnabled = useShuffleStore((s) => s.enabled)

  const currentIndex = currentTrack ? visibleTracks.findIndex((t) => t.id === currentTrack.id) : -1

  function step(direction: -1 | 1): void {
    if (!currentTrack || visibleTracks.length === 0) return
    const nextIndex =
      currentIndex === -1 ? 0 : Math.min(visibleTracks.length - 1, Math.max(0, currentIndex + direction))
    playTrack(visibleTracks[nextIndex])
  }

  // In shuffle mode, "next" (button, media key, or autoplay at the end of a track)
  // picks randomly from whatever's left to avoid repeating the current track,
  // rather than stepping sequentially.
  function next(): void {
    if (shuffleEnabled) {
      if (visibleTracks.length === 0) return
      const choices =
        visibleTracks.length > 1 && currentTrack
          ? visibleTracks.filter((t) => t.id !== currentTrack.id)
          : visibleTracks
      playTrack(choices[Math.floor(Math.random() * choices.length)])
      return
    }
    step(1)
  }

  function previous(): void {
    if (!currentTrack) return
    if (usePlaybackStore.getState().currentTime > RESTART_THRESHOLD_SECONDS) {
      seek(0)
      return
    }
    // With no history yet (e.g. right after launch), fall back to the track above.
    if (!playPreviousFromHistory()) step(-1)
  }

  return {
    next,
    previous,
    hasNext: shuffleEnabled ? visibleTracks.length > 1 : currentIndex !== -1 && currentIndex < visibleTracks.length - 1
  }
}
