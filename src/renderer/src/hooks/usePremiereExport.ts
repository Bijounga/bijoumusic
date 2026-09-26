import { useEffect, useState } from 'react'
import type { Track, SendToPremierePayload } from '@shared/types'
import { useLibraryStore } from '../state/libraryStore'
import { renderTrimmedAudioWav } from '../audio/renderTrimmedAudio'

interface ReadyTemp {
  trackId: number
  start: number
  end: number
  path: string
}

export interface PremiereExport {
  /** True once a trimmed temp file matching the track's *current* preview range
   *  is ready on disk. False while it's still rendering, or when there's no range
   *  to trim — in either case sends/drags fall back to the original file untouched. */
  isTempReady: boolean
  /** Path to hand to startTrackDrag right now — the ready trimmed temp file when
   *  there is one, otherwise the original. Synchronous on purpose: dragstart can't
   *  wait on the render, so the temp file has to already exist by drag time. */
  getDragPath: () => string
  /** Sends the current track to Premiere over the bridge (button flow) — the
   *  extension decides where it lands (its own Auto/track-N setting); throws with
   *  a message on failure so the caller can surface it. */
  sendToPremiere: () => Promise<void>
  /** Tells the extension to watch for the about-to-be-dragged temp file landing,
   *  so it can swap in the original afterward — fire-and-forget, call right before
   *  startTrackDrag. No-op when there's no trim range (nothing to swap). */
  notifyExpectedDrop: () => void
}

/** Keeps a trimmed-to-preview-range temp WAV pre-rendered for whatever track is
 *  passed in, so both the drag handle and the Premiere button can hand Premiere a
 *  file of the right length instantly instead of rendering on demand mid-gesture. */
export function usePremiereExport(track: Track | null): PremiereExport {
  const liveTracks = useLibraryStore((s) => s.tracks)
  const liveTrack = track ? (liveTracks.find((t) => t.id === track.id) ?? track) : null
  const previewStart = liveTrack?.previewStartSeconds ?? null
  const previewEnd = liveTrack?.previewEndSeconds ?? null

  const [tempPath, setTempPath] = useState<ReadyTemp | null>(null)

  useEffect(() => {
    if (!liveTrack || previewStart === null || previewEnd === null) return
    const trackId = liveTrack.id
    const start = previewStart
    const end = previewEnd
    let cancelled = false

    async function render(): Promise<void> {
      const wav = await renderTrimmedAudioWav(trackId, start, end)
      if (cancelled) return
      const path = await window.api.premiereSaveTempAudio(trackId, wav)
      if (cancelled) return
      setTempPath({ trackId, start, end, path })
    }
    void render()

    return () => {
      cancelled = true
    }
  }, [liveTrack, previewStart, previewEnd])

  const isTempReady =
    liveTrack !== null &&
    previewStart !== null &&
    previewEnd !== null &&
    tempPath !== null &&
    tempPath.trackId === liveTrack.id &&
    tempPath.start === previewStart &&
    tempPath.end === previewEnd

  function buildPayload(): SendToPremierePayload | null {
    if (!liveTrack) return null
    if (isTempReady && tempPath) {
      return {
        tempFilePath: tempPath.path,
        originalFilePath: liveTrack.currentPath,
        trimRange: { start: tempPath.start, end: tempPath.end },
        durationSeconds: tempPath.end - tempPath.start
      }
    }
    return {
      tempFilePath: liveTrack.currentPath,
      originalFilePath: liveTrack.currentPath,
      trimRange: null,
      durationSeconds: liveTrack.durationSeconds
    }
  }

  return {
    isTempReady,
    getDragPath: () => (isTempReady && tempPath ? tempPath.path : (liveTrack?.currentPath ?? '')),
    sendToPremiere: async () => {
      const payload = buildPayload()
      if (!payload) throw new Error('No track selected')
      const result = await window.api.premiereSendTrack(payload)
      if (!result.success) throw new Error(result.error ?? 'Unknown error')
    },
    notifyExpectedDrop: () => {
      const payload = buildPayload()
      if (payload?.trimRange) void window.api.premiereExpectDrop(payload)
    }
  }
}
