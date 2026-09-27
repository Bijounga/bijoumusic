import { create } from 'zustand'
import type { Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { useRecentActivityStore } from './recentActivityStore'

const HISTORY_LIMIT = 200

interface PlaybackState {
  currentTrack: Track | null
  isPlaying: boolean
  duration: number
  currentTime: number
  volume: number
  playbackRate: number
  normalizationEnabled: boolean
  /** Tracks played before the current one, most recent last. Every way of
   *  starting a track goes through playTrack, so Back can retrace real listening
   *  history however you got here (random pick, shuffle, clicking a row, ↑/↓). */
  history: Track[]
  playTrack: (track: Track, options?: { fromHistory?: boolean }) => void
  /** Plays the previous track from history; false if there's no history. */
  playPreviousFromHistory: () => boolean
  togglePlayPause: () => void
  seek: (seconds: number) => void
  seekBy: (deltaSeconds: number) => void
  setVolume: (volume: number) => void
  setPlaybackRate: (rate: number) => void
  setNormalizationEnabled: (enabled: boolean) => void
}

export const usePlaybackStore = create<PlaybackState>((set, get) => {
  // Wired once at store creation (not per-render): the singleton audioEngine outlives
  // any component, so its events are mirrored into coarse store state here rather
  // than via a React effect that could double-subscribe across remounts.
  audioEngine.onPlayPauseChange(() => {
    const isPlaying = !audioEngine.isPaused()
    set({ isPlaying })
    // Chromium/Windows arbitrate hardware media keys between whichever app most
    // recently started playing — same as a YouTube tab losing them to a Spotify tab
    // and getting them back once you hit play there again — entirely through this
    // playbackState flag, no globalShortcut/focus bookkeeping needed on our end.
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    }
  })

  audioEngine.onTimeUpdate(() => {
    set({ currentTime: audioEngine.getCurrentTime(), duration: audioEngine.getDuration() })
  })

  return {
    currentTrack: null,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    volume: audioEngine.getVolume(),
    playbackRate: audioEngine.getPlaybackRate(),
    normalizationEnabled: audioEngine.getNormalizationEnabled(),
    history: [],

    playTrack: (track: Track, options?: { fromHistory?: boolean }) => {
      const previous = get().currentTrack
      if (!options?.fromHistory && previous && previous.id !== track.id) {
        set({ history: [...get().history, previous].slice(-HISTORY_LIMIT) })
      }
      audioEngine.loadTrack(track.id, track.loudnessRms)
      void window.api.logPlaybackEvent(track.id, 'played').then(() => {
        // Keep Recently Played / Most Used fresh so they reflect what you're doing
        // right now, not just whatever was true the last time you opened that view.
        const recent = useRecentActivityStore.getState()
        void recent.loadRecentlyPlayed()
        void recent.loadMostUsed()
      })

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.filename,
          artist: track.folderPath || undefined
        })
        navigator.mediaSession.playbackState = 'playing'
      }

      set({ currentTrack: track, isPlaying: true, currentTime: 0, duration: 0 })
    },

    playPreviousFromHistory: () => {
      const history = get().history
      const previous = history[history.length - 1]
      if (!previous) return false
      set({ history: history.slice(0, -1) })
      get().playTrack(previous, { fromHistory: true })
      return true
    },

    togglePlayPause: () => {
      if (get().currentTrack) audioEngine.togglePlayPause()
    },

    seek: (seconds: number) => {
      audioEngine.seek(seconds)
    },

    seekBy: (deltaSeconds: number) => {
      if (!get().currentTrack) return
      const duration = audioEngine.getDuration()
      const target = audioEngine.getCurrentTime() + deltaSeconds
      const clamped = duration > 0 ? Math.min(Math.max(target, 0), duration) : Math.max(target, 0)
      audioEngine.seek(clamped)
    },

    setVolume: (volume: number) => {
      audioEngine.setVolume(volume)
      set({ volume: audioEngine.getVolume() })
    },

    setPlaybackRate: (rate: number) => {
      audioEngine.setPlaybackRate(rate)
      set({ playbackRate: audioEngine.getPlaybackRate() })
    },

    setNormalizationEnabled: (enabled: boolean) => {
      audioEngine.setNormalizationEnabled(enabled)
      set({ normalizationEnabled: audioEngine.getNormalizationEnabled() })
    }
  }
})
