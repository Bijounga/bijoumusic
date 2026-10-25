import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { detectTrackBpm, generateWaveformPeaks } from './generateWaveformPeaks'
import { useLibraryStore } from '../state/libraryStore'

const DELAY_BETWEEN_TRACKS_MS = 350
const MIN_SECONDS_FOR_BPM = 12

/** Walks the whole library in the background, one track at a time, generating and
 *  caching a waveform for anything that doesn't have one yet — so per-row waveforms
 *  fill in on their own instead of only appearing for tracks you've actually opened.
 *  A small delay between tracks keeps this from competing with anything you're doing;
 *  restarting only on `tracks.length` (not every array reference change) means a
 *  duration patch mid-run doesn't reset the whole pass back to the start. */
export function useBackgroundWaveformGeneration(tracks: Track[]): void {
  const setTrackDuration = useLibraryStore((s) => s.setTrackDuration)
  const setTrackLoudness = useLibraryStore((s) => s.setTrackLoudness)
  const setTrackBpm = useLibraryStore((s) => s.setTrackBpm)
  const runIdRef = useRef(0)

  useEffect(() => {
    const runId = ++runIdRef.current
    const queue = tracks

    async function fillInBpm(track: Track): Promise<void> {
      // Sound effects and other clips too short to have a beat don't need decoding.
      let bpm = 0
      if (track.durationSeconds === null || track.durationSeconds >= MIN_SECONDS_FOR_BPM) {
        let found: number | null
        try {
          found = await detectTrackBpm(track.id)
        } catch {
          return // Unreadable file: leave it for a later pass rather than marking it beatless.
        }
        if (runIdRef.current !== runId || found === null) return
        bpm = found
      }
      void window.api.updateTrackBpm(track.id, bpm)
      setTrackBpm(track.id, bpm)
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_TRACKS_MS))
    }

    async function run(): Promise<void> {
      for (const track of queue) {
        if (runIdRef.current !== runId) return

        const existing = await window.api.getWaveformPeaks(track.contentHash)
        if (runIdRef.current !== runId) return
        if (existing) {
          // Waveform made before tempo detection existed: just work out the tempo.
          if (track.bpm === null) await fillInBpm(track)
          continue
        }

        try {
          const { peaks, durationSeconds, rms, bpm } = await generateWaveformPeaks(track.id)
          if (runIdRef.current !== runId) return
          void window.api.saveWaveformPeaks(track.contentHash, peaks)
          if (track.durationSeconds === null) {
            void window.api.updateTrackDuration(track.id, durationSeconds)
            setTrackDuration(track.id, durationSeconds)
          }
          void window.api.updateTrackLoudness(track.id, rms)
          setTrackLoudness(track.id, rms)
          if (bpm !== null) {
            void window.api.updateTrackBpm(track.id, bpm)
            setTrackBpm(track.id, bpm)
          }
        } catch {
          // One unreadable file shouldn't stop the rest of the background pass.
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_TRACKS_MS))
      }
    }

    void run()
    return () => {
      runIdRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length, setTrackDuration, setTrackLoudness, setTrackBpm])
}
