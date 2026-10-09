import { useEffect, useRef } from 'react'
import type { MiniPlayerState, Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useThemeStore } from '../state/themeStore'
import { useTransportControls } from './useTransportControls'

function snapshot(): MiniPlayerState {
  const s = usePlaybackStore.getState()
  return {
    track: s.currentTrack,
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    theme: useThemeStore.getState().theme,
    volume: s.volume
  }
}

/** Main-window side of the pop-out mini player. While it's open, playback state
 *  and the theme are streamed to it (via direct store subscriptions, not React
 *  state, so the app shell doesn't re-render on every ~4Hz time update), and its
 *  button presses are run here, where playback actually lives. The theme is sent
 *  explicitly because localStorage change events don't reach the other window. */
export function useMiniPlayerBridge(visibleTracks: Track[]): void {
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const seek = usePlaybackStore((s) => s.seek)
  const setVolume = usePlaybackStore((s) => s.setVolume)
  const { next, previous } = useTransportControls(visibleTracks)

  const handlersRef = useRef({ togglePlayPause, seek, setVolume, next, previous })
  handlersRef.current = { togglePlayPause, seek, setVolume, next, previous }

  useEffect(() => {
    const unsubscribers: (() => void)[] = []
    const stopStreaming = (): void => {
      while (unsubscribers.length) unsubscribers.pop()?.()
    }
    const unsubscribeOpen = window.api.onMiniOpenChanged((open) => {
      stopStreaming()
      if (!open) return
      window.api.miniSendState(snapshot())
      unsubscribers.push(
        usePlaybackStore.subscribe((state, prev) => {
          if (
            state.currentTrack !== prev.currentTrack ||
            state.isPlaying !== prev.isPlaying ||
            state.currentTime !== prev.currentTime ||
            state.duration !== prev.duration ||
            state.volume !== prev.volume
          ) {
            window.api.miniSendState(snapshot())
          }
        }),
        useThemeStore.subscribe((state, prev) => {
          if (state.theme !== prev.theme) window.api.miniSendState(snapshot())
        })
      )
    })
    return () => {
      unsubscribeOpen()
      stopStreaming()
    }
  }, [])

  useEffect(() => {
    return window.api.onMiniCommand((command) => {
      const h = handlersRef.current
      if (command.type === 'toggle') h.togglePlayPause()
      else if (command.type === 'next') h.next()
      else if (command.type === 'previous') h.previous()
      else if (command.type === 'volume') h.setVolume(command.value)
      else if (command.type === 'seek') {
        const duration = usePlaybackStore.getState().duration
        if (duration > 0) h.seek(Math.min(1, Math.max(0, command.fraction)) * duration)
      }
    })
  }, [])
}
