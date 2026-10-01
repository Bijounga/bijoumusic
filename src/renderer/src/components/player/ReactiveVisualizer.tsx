import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { useAlbumArt } from '../../audio/useAlbumArt'
import { usePlaybackStore } from '../../state/playbackStore'
import { useTrackTagColors } from '../../hooks/useTrackTagColors'
import { tagColorForSlot } from '../../lib/tagColors'
import { audioEngine } from '../../audio/AudioEngine'
import { useThemeStore } from '../../state/themeStore'
import { cachedThemeColor, startVisualLoop } from '../../lib/visualLoop'
import styles from './ReactiveVisualizer.module.css'

const CANVAS_SIZE = 150
const INNER_RADIUS = 48
const MIN_BAR_LENGTH = 4
const MAX_BAR_LENGTH = 26
const BAR_COUNT = 32
// Most music's energy is concentrated in the lower half of even a small FFT's
// bins — the upper (high-frequency) half reads near-silent almost all the time,
// which left literally half the ring looking dead. Mirroring the lower, livelier
// half across both sides keeps the whole circle reactive instead of half of it.
const USABLE_BINS = 16

const themeColor = cachedThemeColor

/** Live frequency bars (real audio analysis, not the pre-computed waveform peaks)
 *  around the disc while playing; a calm flat ring at rest. Idle state is drawn
 *  explicitly rather than trusting however the analyser happens to behave once the
 *  underlying <audio> element is paused (that's not well-defined enough to rely on).
 *
 *  Always shows full-strength tag colors (blue fallback only when the track has
 *  no tags at all) — unlike the waveform panel, this doesn't fade toward the
 *  fallback via the waveform intensity slider, which is scoped to the waveform
 *  display specifically, not every tag-colored visual in the app.
 *
 *  Reads theme tokens fresh on every draw (themeColor() below). While playing
 *  that's every frame; while paused it draws once, and the active theme is in
 *  the effect deps so a theme switch still repaints it.
 *
 *  The backing store is only resized when the size actually changes — resetting
 *  canvas.width every frame reallocated it 60 times a second, which was a large
 *  share of the app's GPU-process load during playback. */
function drawRing(canvas: HTMLCanvasElement, tagColors: string[], isPlaying: boolean): void {
  const dpr = window.devicePixelRatio || 1
  const px = Math.round(CANVAS_SIZE * dpr)
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px
    canvas.height = px
    canvas.style.width = `${CANVAS_SIZE}px`
    canvas.style.height = `${CANVAS_SIZE}px`
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  const cx = CANVAS_SIZE / 2
  const cy = CANVAS_SIZE / 2
  const data = isPlaying ? audioEngine.getFrequencyData() : null
  const fallback = themeColor('--accent')

  ctx.lineWidth = 3
  ctx.lineCap = 'round'

  for (let i = 0; i < BAR_COUNT; i++) {
    ctx.strokeStyle = tagColorForSlot(i, BAR_COUNT, tagColors, fallback)
    let magnitude = 0
    if (data) {
      // Fold the bar index into the usable (lower) bin range, mirrored, so both
      // halves of the circle draw from the same lively data instead of the back
      // half reading whatever's left in the near-silent high end.
      const half = i < BAR_COUNT / 2 ? i : BAR_COUNT - 1 - i
      const bin = Math.floor((half / (BAR_COUNT / 2)) * USABLE_BINS)
      // A square-root curve compresses the dynamic range so quiet bins still show
      // a visible bar instead of vanishing — raw byte values skew low for most
      // content, which is what made half the ring look empty rather than just quiet.
      magnitude = Math.sqrt(data[bin] / 255)
    }
    const barLength = MIN_BAR_LENGTH + magnitude * (MAX_BAR_LENGTH - MIN_BAR_LENGTH)
    const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    ctx.beginPath()
    ctx.moveTo(cx + INNER_RADIUS * cos, cy + INNER_RADIUS * sin)
    ctx.lineTo(cx + (INNER_RADIUS + barLength) * cos, cy + (INNER_RADIUS + barLength) * sin)
    ctx.stroke()
  }
}

function ReactiveVisualizer({ track }: { track: Track | null }): React.JSX.Element | null {
  const art = useAlbumArt(track)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const tagColors = useTrackTagColors(track?.id)
  const theme = useThemeStore((s) => s.theme)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Animates only while playing; paused, the idle ring doesn't change, so it's
  // drawn once instead of 60 times a second.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !track) return
    drawRing(canvas, tagColors, isPlaying)
    if (!isPlaying) return
    return startVisualLoop(() => drawRing(canvas, tagColors, isPlaying))
  }, [track, isPlaying, tagColors, theme])

  if (!track) return null

  return (
    <div className={styles.wrap}>
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className={styles.ring} />
      {art && (
        <div className={styles.discClip}>
          <img className={`${styles.disc} ${isPlaying ? styles.discSpinning : ''}`} src={art} alt="" />
        </div>
      )}
    </div>
  )
}

export default ReactiveVisualizer
