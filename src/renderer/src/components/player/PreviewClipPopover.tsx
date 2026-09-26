import { useEffect, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../../state/playbackStore'
import { usePreviewClipStore } from '../../state/previewClipStore'
import { useLibraryStore } from '../../state/libraryStore'
import { formatDuration } from '../../lib/format'
import styles from './PreviewClipPopover.module.css'

function PreviewClipPopover({ track }: { track: Track | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const currentTime = usePlaybackStore((s) => s.currentTime)
  const seek = usePlaybackStore((s) => s.seek)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  const activePreview = usePreviewClipStore((s) => s.active)
  const startPreview = usePreviewClipStore((s) => s.startPreview)
  const stopPreview = usePreviewClipStore((s) => s.stopPreview)

  const setTrackPreviewRange = useLibraryStore((s) => s.setTrackPreviewRange)
  // `track` is a snapshot captured when playback started and never gets patched in
  // place, so reading the preview range straight off it would show stale (usually
  // null) values right after setting one — libraryStore's copy is the live one.
  const liveTracks = useLibraryStore((s) => s.tracks)
  const liveTrack = track ? (liveTracks.find((t) => t.id === track.id) ?? track) : null

  const isLooping = !!(activePreview && track && activePreview.trackId === track.id)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  function persistRange(start: number | null, end: number | null): void {
    if (!track) return
    void window.api.updateTrackPreviewRange(track.id, start, end)
    setTrackPreviewRange(track.id, start, end)
  }

  function setStartHere(): void {
    if (!liveTrack) return
    const end =
      liveTrack.previewEndSeconds !== null && liveTrack.previewEndSeconds > currentTime
        ? liveTrack.previewEndSeconds
        : null
    persistRange(currentTime, end)
  }

  function setEndHere(): void {
    if (!liveTrack) return
    const start =
      liveTrack.previewStartSeconds !== null && liveTrack.previewStartSeconds < currentTime
        ? liveTrack.previewStartSeconds
        : 0
    persistRange(start, currentTime)
  }

  function clearRange(): void {
    if (!track) return
    persistRange(null, null)
    if (isLooping) stopPreview()
  }

  function playPreview(): void {
    if (!track || !liveTrack || liveTrack.previewStartSeconds === null || liveTrack.previewEndSeconds === null) return
    startPreview(track.id, liveTrack.previewStartSeconds, liveTrack.previewEndSeconds)
    seek(liveTrack.previewStartSeconds)
    if (!isPlaying) togglePlayPause()
  }

  const hasRange = liveTrack?.previewStartSeconds !== null && liveTrack?.previewEndSeconds !== null
  const summary =
    hasRange && liveTrack
      ? `${formatDuration(liveTrack.previewStartSeconds)}–${formatDuration(liveTrack.previewEndSeconds)}`
      : 'Preview'

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${hasRange ? styles.triggerActive : ''} ${isLooping ? styles.triggerLooping : ''}`}
        disabled={!track}
        onClick={() => setOpen((v) => !v)}
      >
        {summary}
      </button>

      {open && track && (
        <div className={styles.popover}>
          <p className={styles.hint}>The best-part clip to audition instead of the whole track.</p>
          <div className={styles.row}>
            <button className={styles.actionBtn} onClick={setStartHere} title={`Set start at ${formatDuration(currentTime)}`}>
              Start here ({formatDuration(currentTime)})
            </button>
          </div>
          <div className={styles.row}>
            <button className={styles.actionBtn} onClick={setEndHere} title={`Set end at ${formatDuration(currentTime)}`}>
              End here ({formatDuration(currentTime)})
            </button>
          </div>
          {hasRange && (
            <>
              <div className={styles.row}>
                <button className={styles.actionBtn} onClick={isLooping ? stopPreview : playPreview}>
                  {isLooping ? '■ Stop looping preview' : '▶ Play preview (loops)'}
                </button>
              </div>
              <div className={styles.row}>
                <button className={`${styles.actionBtn} ${styles.clearBtn}`} onClick={clearRange}>
                  Clear preview range
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default PreviewClipPopover
