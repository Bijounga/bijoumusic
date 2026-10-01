import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useTransportControls } from './useTransportControls'

/** Wires hardware/on-screen media-key handling through the browser's native Media
 *  Session API instead of an OS-wide keybind grab — Windows (and macOS/Chrome OS)
 *  already arbitrate those keys between whichever app most recently started
 *  playing, exactly like switching between two browser tabs each playing audio, so
 *  there's no need to hand-roll that recency logic ourselves.
 *
 *  The handlers are registered exactly once and call through refs. next/previous
 *  are new functions on every render, and re-registering on each one sent ~30
 *  setActionHandler calls a second into Windows' media service (and on to the
 *  Bluetooth AVCTP service), which over a long session ballooned that service's
 *  CPU and memory and made the app and Windows shutdown hang. */
export function useMediaSession(visibleTracks: Track[]): void {
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const { next, previous } = useTransportControls(visibleTracks)

  const handlersRef = useRef({ togglePlayPause, next, previous })
  handlersRef.current = { togglePlayPause, next, previous }

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.setActionHandler('play', () => handlersRef.current.togglePlayPause())
    navigator.mediaSession.setActionHandler('pause', () => handlersRef.current.togglePlayPause())
    navigator.mediaSession.setActionHandler('previoustrack', () => handlersRef.current.previous())
    navigator.mediaSession.setActionHandler('nexttrack', () => handlersRef.current.next())

    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
  }, [])
}
