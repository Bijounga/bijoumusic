import { useEffect } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useTransportControls } from './useTransportControls'

/** Wires hardware/on-screen media-key handling through the browser's native Media
 *  Session API instead of an OS-wide keybind grab — Windows (and macOS/Chrome OS)
 *  already arbitrate those keys between whichever app most recently started
 *  playing, exactly like switching between two browser tabs each playing audio, so
 *  there's no need to hand-roll that recency logic ourselves. */
export function useMediaSession(visibleTracks: Track[]): void {
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const { next, previous } = useTransportControls(visibleTracks)

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.setActionHandler('play', () => togglePlayPause())
    navigator.mediaSession.setActionHandler('pause', () => togglePlayPause())
    navigator.mediaSession.setActionHandler('previoustrack', () => previous())
    navigator.mediaSession.setActionHandler('nexttrack', () => next())

    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }, [togglePlayPause, next, previous])
}
