import { useRef } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useShuffleStore } from '../state/shuffleStore'

const RESTART_VS_PREVIOUS_WINDOW_MS = 2500

interface TransportControls {
  next: () => void
  previous: () => void
  hasNext: boolean
}

/** Shared next/previous logic for the bottom bar buttons, media keys, and (later)
 *  anything else that needs transport controls — steps through the same
 *  `visibleTracks` list TrackList renders, so it never disagrees with what's on screen. */
export function useTransportControls(visibleTracks: Track[]): TransportControls {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const playTrack = usePlaybackStore((s) => s.playTrack)
  const seek = usePlaybackStore((s) => s.seek)
  const shuffleEnabled = useShuffleStore((s) => s.enabled)
  const pushShuffleHistory = useShuffleStore((s) => s.pushHistory)
  const popShuffleHistory = useShuffleStore((s) => s.popHistory)
  const lastPreviousPressRef = useRef(0)

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
      if (currentTrack) pushShuffleHistory(currentTrack)
      playTrack(choices[Math.floor(Math.random() * choices.length)])
      return
    }
    step(1)
  }

  // First press restarts the current track; a second press within the window steps
  // back a track instead — so a stray tap doesn't skip past the track you meant to
  // restart, but a deliberate quick double-tap still goes back. In shuffle mode,
  // "back" retraces the actual shuffle history rather than stepping through the
  // visible list's order, which shuffle deliberately isn't following.
  function previous(): void {
    if (!currentTrack) return
    const now = Date.now()
    const isDoublePress = now - lastPreviousPressRef.current < RESTART_VS_PREVIOUS_WINDOW_MS
    lastPreviousPressRef.current = now
    if (!isDoublePress) {
      seek(0)
      return
    }
    if (shuffleEnabled) {
      const previousTrack = popShuffleHistory()
      if (previousTrack) playTrack(previousTrack)
    } else {
      step(-1)
    }
  }

  return {
    next,
    previous,
    hasNext: shuffleEnabled ? visibleTracks.length > 1 : currentIndex !== -1 && currentIndex < visibleTracks.length - 1
  }
}
