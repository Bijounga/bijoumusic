import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { audioEngine } from '../audio/AudioEngine'
import { usePlaybackStore } from '../state/playbackStore'
import { usePreviewClipStore } from '../state/previewClipStore'
import { useAuditionStore } from '../state/auditionStore'
import { useAutoplayStore } from '../state/autoplayStore'
import { useTransportControls } from './useTransportControls'

// How long a track has to actually play (wall-clock, not scrubbed-past) before
// rapid audition mode auto-advances.
const AUDITION_DURATION_SECONDS = 10
// A currentTime jump bigger than this in one tick is a seek/scrub, not normal
// playback progress — used to tell the two apart without threading a "the user
// just interacted" flag through every call site that can move the playhead.
const SEEK_JUMP_THRESHOLD_SECONDS = 1.5

/** Watches playback for three boundary conditions, mounted once at the app root: a
 *  preview clip looping back to its start once it hits its end; (in rapid audition
 *  mode) auto-advancing to the next track after a few seconds so you can skim a long
 *  list without playing each one through; and (with "keep playing" on) advancing to
 *  the next track when one finishes naturally, so playback doesn't just stop dead.
 *
 *  Audition's countdown runs on wall-clock time, not on the track's own currentTime
 *  — otherwise scrubbing forward past the window instantly "uses up" the countdown
 *  and skips the track out from under you the moment you touch the waveform. Any
 *  seek (scrubbing, a bookmark jump, a keyboard seek, playing a preview clip) resets
 *  the countdown instead: interacting with a track reads as being interested in it,
 *  not as a reason to cut it off sooner. Pausing also holds the countdown — sitting
 *  on a track to think about it shouldn't cost you the track when you resume. */
export function usePlaybackBoundaryEnforcer(visibleTracks: Track[]): void {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const seek = usePlaybackStore((s) => s.seek)
  const activePreview = usePreviewClipStore((s) => s.active)
  const auditionEnabled = useAuditionStore((s) => s.enabled)
  const autoplayEnabled = useAutoplayStore((s) => s.enabled)
  const { next } = useTransportControls(visibleTracks)

  const advancedForTrackIdRef = useRef<number | null>(null)
  const auditionClockStartRef = useRef(Date.now())
  const lastCurrentTimeRef = useRef(0)

  useEffect(() => {
    if (!currentTrack) return

    if (activePreview && activePreview.trackId === currentTrack.id) {
      if (currentTime >= activePreview.end) seek(activePreview.start)
      lastCurrentTimeRef.current = currentTime
      return
    }

    const jumped = Math.abs(currentTime - lastCurrentTimeRef.current) > SEEK_JUMP_THRESHOLD_SECONDS
    lastCurrentTimeRef.current = currentTime

    if (!isPlaying || jumped) {
      // Keep resetting while paused (not just once) so an arbitrarily long pause
      // doesn't leave a stale countdown ready to fire the instant you hit play again.
      auditionClockStartRef.current = Date.now()
      return
    }

    if (auditionEnabled && Date.now() - auditionClockStartRef.current >= AUDITION_DURATION_SECONDS * 1000) {
      if (advancedForTrackIdRef.current === currentTrack.id) return
      advancedForTrackIdRef.current = currentTrack.id
      next()
    }
  }, [currentTrack, currentTime, isPlaying, activePreview, auditionEnabled, seek, next])

  // A fresh track (including the one just auto-advanced to) is fair game again.
  useEffect(() => {
    advancedForTrackIdRef.current = null
    auditionClockStartRef.current = Date.now()
    lastCurrentTimeRef.current = 0
  }, [currentTrack?.id])

  useEffect(() => {
    return audioEngine.onEnded(() => {
      if (autoplayEnabled) next()
    })
  }, [autoplayEnabled, next])
}
