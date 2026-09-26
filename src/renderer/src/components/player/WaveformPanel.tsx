import { useEffect, useRef, useState } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import { useWaveformPeaks } from '../../audio/useWaveformPeaks'
import { usePreviewClipStore } from '../../state/previewClipStore'
import { useLibraryStore } from '../../state/libraryStore'
import { useTrackTagColors } from '../../hooks/useTrackTagColors'
import { waveformFillStyle } from '../../lib/tagColors'
import { useWaveformIntensityStore } from '../../state/waveformIntensityStore'
import { audioEngine } from '../../audio/AudioEngine'
import { formatDuration } from '../../lib/format'
import styles from './WaveformPanel.module.css'

// Below this fraction of the timeline, a drag while drawing a range is treated as
// an accidental click rather than a deliberate (if tiny) selection.
const MIN_RANGE_DRAG_FRACTION = 0.005

const MIN_BAR_HEIGHT = 2
// While dragging, the visual playhead tracks the pointer every move, but the actual
// audio seek is throttled to this interval — seeking on literally every pointermove
// thrashes decode/output faster than audio can catch up and just produces silence;
// spacing seeks out this much gives the browser time to actually output a few
// frames each time, which is what makes the scrub audible.
const SCRUB_SEEK_THROTTLE_MS = 100

/** Reads live theme tokens rather than hardcoding colors, so a theme change (e.g.
 *  adjusting --accent) propagates here automatically without touching this file. */
function themeColor(cssVar: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
  peaks: Float32Array,
  tagColors: string[],
  fallbackColor: string,
  alpha: number,
  tagIntensity: number
): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = widthPx * dpr
  canvas.height = heightPx * dpr
  canvas.style.width = `${widthPx}px`
  canvas.style.height = `${heightPx}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, widthPx, heightPx)
  ctx.globalAlpha = alpha
  ctx.fillStyle = waveformFillStyle(ctx, widthPx, tagColors, fallbackColor, tagIntensity)

  const bucketCount = peaks.length / 2
  const barWidth = widthPx / bucketCount
  const midY = heightPx / 2

  for (let i = 0; i < bucketCount; i++) {
    const min = peaks[i * 2]
    const max = peaks[i * 2 + 1]
    // Guaranteed minimum visible height even in silence, so quiet sections read as
    // "quiet audio" rather than "no data".
    const barHeight = Math.max((max - min) * heightPx * 0.5, MIN_BAR_HEIGHT)
    const x = i * barWidth
    ctx.fillRect(x, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight)
  }
}

function WaveformPanel(): React.JSX.Element {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const seek = usePlaybackStore((s) => s.seek)
  const duration = usePlaybackStore((s) => s.duration)
  const { peaks, isLoading, failed } = useWaveformPeaks(currentTrack)
  const tagColors = useTrackTagColors(currentTrack?.id)
  const tagIntensity = useWaveformIntensityStore((s) => s.intensity)
  const setTagIntensity = useWaveformIntensityStore((s) => s.setIntensity)

  const containerRef = useRef<HTMLDivElement>(null)
  const dimCanvasRef = useRef<HTMLCanvasElement>(null)
  const brightCanvasRef = useRef<HTMLCanvasElement>(null)
  const progressWrapRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const wasPlayingBeforeDragRef = useRef(false)
  const lastAudibleSeekRef = useRef(0)
  const hoverLineRef = useRef<HTMLDivElement>(null)
  const hoverTimeRef = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  const isDrawingRange = usePreviewClipStore((s) => s.isDrawingRange)
  const setTrackPreviewRange = useLibraryStore((s) => s.setTrackPreviewRange)
  const liveTracks = useLibraryStore((s) => s.tracks)
  const rangeOverlayRef = useRef<HTMLDivElement>(null)
  const isDrawingDragRef = useRef(false)
  const drawAnchorFractionRef = useRef(0)
  const [isDrawingDrag, setIsDrawingDrag] = useState(false)

  // Shows the track's already-saved in/out range (if any) on the waveform even
  // when not actively dragging one, so a range set earlier — via the Preview
  // popover's buttons or a keybind — is visible here too, not just while drawing.
  useEffect(() => {
    if (isDrawingDragRef.current) return
    const liveTrack = currentTrack ? liveTracks.find((t) => t.id === currentTrack.id) : null
    if (!liveTrack || duration <= 0 || liveTrack.previewStartSeconds === null || liveTrack.previewEndSeconds === null) {
      if (rangeOverlayRef.current) rangeOverlayRef.current.style.width = '0%'
      return
    }
    updateRangeOverlayVisual(liveTrack.previewStartSeconds / duration, liveTrack.previewEndSeconds / duration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, liveTracks, duration])

  // Static waveform, redrawn only when peaks change or the panel resizes — not on
  // every frame, which is what keeps this cheap.
  useEffect(() => {
    const container = containerRef.current
    const dimCanvas = dimCanvasRef.current
    const brightCanvas = brightCanvasRef.current
    if (!container || !dimCanvas || !brightCanvas || !peaks) return

    const redraw = (): void => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return
      // With tag colors to work with, the dim layer becomes a faded version of the
      // same gradient (rather than a flat theme color) so the two layers read as
      // "the track's own colors, dimmed" vs "lit up" instead of two unrelated hues.
      const dimAlpha = tagColors.length > 0 ? 0.4 : 1
      drawWaveform(dimCanvas, width, height, peaks, tagColors, themeColor('--waveform-dim'), dimAlpha, tagIntensity)
      drawWaveform(brightCanvas, width, height, peaks, tagColors, themeColor('--accent'), 1, tagIntensity)
    }

    redraw()
    const resizeObserver = new ResizeObserver(redraw)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [peaks, tagColors, tagIntensity])

  // Playhead progress: updates the clip width every animation frame by reading the
  // audio engine directly, bypassing React state entirely — this is what keeps the
  // moving progress edge smooth instead of causing a re-render per frame.
  useEffect(() => {
    if (!currentTrack) return

    let rafId: number
    const tick = (): void => {
      const duration = audioEngine.getDuration()
      const fraction = duration > 0 ? audioEngine.getCurrentTime() / duration : 0
      updatePlayheadVisual(Math.min(1, Math.max(0, fraction)))
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [currentTrack])

  function updatePlayheadVisual(fraction: number): void {
    if (progressWrapRef.current) progressWrapRef.current.style.width = `${fraction * 100}%`
    if (playheadRef.current) playheadRef.current.style.left = `${fraction * 100}%`
  }

  function fractionFromClientX(clientX: number): number {
    const container = containerRef.current
    if (!container) return 0
    const rect = container.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  function updateRangeOverlayVisual(fromFraction: number, toFraction: number): void {
    if (!rangeOverlayRef.current) return
    const start = Math.min(fromFraction, toFraction)
    const end = Math.max(fromFraction, toFraction)
    rangeOverlayRef.current.style.left = `${start * 100}%`
    rangeOverlayRef.current.style.width = `${(end - start) * 100}%`
  }

  // Press-and-drag anywhere on the panel scrubs — not just the playhead handle.
  // While dragging, playback is forced on (temporarily, if it was paused) and
  // throttled so seeking actually produces audible sound instead of silence, then
  // restored to whatever state it was in before the drag started.
  //
  // Right-click-drag always draws a range, regardless of the isDrawingRange
  // toggle — a quicker path than switching modes first for a one-off range.
  // The toggle still exists so left-click can draw ranges repeatedly without
  // holding down the right button each time.
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!currentTrack) return
    const duration = audioEngine.getDuration()
    if (!(duration > 0)) return

    const isRightClick = event.button === 2
    if (isDrawingRange || isRightClick) {
      isDrawingDragRef.current = true
      setIsDrawingDrag(true)
      const fraction = fractionFromClientX(event.clientX)
      drawAnchorFractionRef.current = fraction
      updateRangeOverlayVisual(fraction, fraction)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (event.button !== 0) return

    isDraggingRef.current = true
    setIsDragging(true)
    wasPlayingBeforeDragRef.current = !audioEngine.isPaused()
    if (audioEngine.isPaused()) audioEngine.play()
    event.currentTarget.setPointerCapture(event.pointerId)

    const fraction = fractionFromClientX(event.clientX)
    updatePlayheadVisual(fraction)
    seek(fraction * duration)
    lastAudibleSeekRef.current = Date.now()
  }

  function updateHoverVisual(fraction: number, duration: number): void {
    if (hoverLineRef.current) hoverLineRef.current.style.left = `${fraction * 100}%`
    if (hoverTimeRef.current) {
      hoverTimeRef.current.textContent = formatDuration(fraction * duration)
      hoverTimeRef.current.style.left = `${fraction * 100}%`
      // Centered normally, but clamped inward near either edge so the label never
      // runs off the panel.
      const edgeOffset = fraction < 0.05 ? '0%' : fraction > 0.95 ? '-100%' : '-50%'
      hoverTimeRef.current.style.transform = `translateX(${edgeOffset})`
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!currentTrack) return
    const duration = audioEngine.getDuration()
    if (!(duration > 0)) return

    const fraction = fractionFromClientX(event.clientX)

    if (isDrawingDragRef.current) {
      updateRangeOverlayVisual(drawAnchorFractionRef.current, fraction)
      return
    }

    updateHoverVisual(fraction, duration)

    if (!isDraggingRef.current) return
    updatePlayheadVisual(fraction)

    const now = Date.now()
    if (now - lastAudibleSeekRef.current >= SCRUB_SEEK_THROTTLE_MS) {
      seek(fraction * duration)
      lastAudibleSeekRef.current = now
    }
  }

  function handlePointerEnter(): void {
    setIsHovering(true)
  }

  function handlePointerLeave(): void {
    setIsHovering(false)
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (isDrawingDragRef.current) {
      isDrawingDragRef.current = false
      setIsDrawingDrag(false)
      event.currentTarget.releasePointerCapture(event.pointerId)

      const duration = audioEngine.getDuration()
      if (currentTrack && duration > 0) {
        const fraction = fractionFromClientX(event.clientX)
        const anchor = drawAnchorFractionRef.current
        if (Math.abs(fraction - anchor) >= MIN_RANGE_DRAG_FRACTION) {
          const start = Math.min(anchor, fraction) * duration
          const end = Math.max(anchor, fraction) * duration
          void window.api.updateTrackPreviewRange(currentTrack.id, start, end)
          setTrackPreviewRange(currentTrack.id, start, end)
        }
      }
      return
    }

    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)

    const duration = audioEngine.getDuration()
    if (duration > 0) {
      // Final seek isn't throttled, so release always lands exactly where you let go.
      const fraction = fractionFromClientX(event.clientX)
      updatePlayheadVisual(fraction)
      seek(fraction * duration)
    }

    if (!wasPlayingBeforeDragRef.current) audioEngine.pause()
  }

  return (
    <div
      className={`${styles.panel} ${isDrawingRange ? styles.panelDrawing : ''}`}
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(event) => event.preventDefault()}
    >
      {!currentTrack && <div className={styles.hint}>Select a track to see its waveform</div>}
      {currentTrack && isLoading && <div className={styles.hint}>Generating waveform…</div>}
      {currentTrack && failed && <div className={styles.hint}>Couldn't load this file's audio</div>}
      <canvas ref={dimCanvasRef} className={styles.canvasLayer} />
      <div ref={progressWrapRef} className={styles.progressWrap}>
        <canvas ref={brightCanvasRef} className={styles.canvasLayer} />
      </div>
      <div
        ref={rangeOverlayRef}
        className={`${styles.rangeOverlay} ${isDrawingDrag ? styles.rangeOverlayDrawing : ''}`}
      />
      {currentTrack && (
        <>
          <div
            ref={hoverLineRef}
            className={`${styles.hoverLine} ${isHovering && !isDragging ? styles.hoverVisible : ''}`}
          />
          <div
            ref={hoverTimeRef}
            className={`${styles.hoverTime} ${isHovering && !isDragging ? styles.hoverVisible : ''}`}
          />
        </>
      )}
      {currentTrack && (
        <div ref={playheadRef} className={`${styles.playhead} ${isDragging ? styles.playheadDragging : ''}`}>
          <div className={styles.playheadHandle} />
        </div>
      )}
      {currentTrack && tagColors.length > 0 && (
        <div
          className={`${styles.tagIntensityControl} ${isHovering ? styles.tagIntensityVisible : ''}`}
          title={`Tag color strength: ${Math.round(tagIntensity * 100)}%`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(tagIntensity * 100)}
            onChange={(e) => setTagIntensity(Number(e.target.value) / 100)}
          />
        </div>
      )}
    </div>
  )
}

export default WaveformPanel
