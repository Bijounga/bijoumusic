import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../../state/playbackStore'
import { useTrackTagColors } from '../../hooks/useTrackTagColors'
import { mixColor, tagColorForSlot } from '../../lib/tagColors'
import { audioEngine } from '../../audio/AudioEngine'
import { useThemeStore } from '../../state/themeStore'
import { cachedThemeColor, startVisualLoop } from '../../lib/visualLoop'
import styles from './AudioAnalyzerPanels.module.css'

const PANEL_WIDTH = 130
const PANEL_HEIGHT = 72

// The spectrogram's scroll history lives in a fixed-integer-size offscreen
// buffer, entirely separate from the visible (possibly DPR-scaled) canvas.
// Self-shifting a canvas whose device-pixel size is derived from
// PANEL_WIDTH * devicePixelRatio breaks whenever that multiplication isn't a
// whole number (125%/150% Windows scaling are common cases) — the shift
// then lands on a fractional pixel boundary and the history corrupts into
// the blocky, disconnected look this replaces. Working in a buffer with a
// plain integer size sidesteps the problem entirely, independent of the
// display's scale factor.
const SPECTROGRAM_BUFFER_WIDTH = 130
const SPECTROGRAM_BUFFER_HEIGHT = 72

// The hi-res analyser has 1024 bins (fftSize 2048), but at a typical 44.1kHz
// sample rate most of that range is near-silent high frequencies nobody's music
// actually uses — restricting to the lower ~40% keeps both panels visually
// active instead of mostly dead space, same reasoning as the ring's USABLE_BINS.
const USABLE_BINS = 400
const SPECTRUM_BAR_COUNT = 44
const BAR_GAP = 2

const themeColor = cachedThemeColor

/** A hotter, more "lit up" ramp than a flat two-color mix — quiet content
 *  stays close to the dim base, but content pushing toward full magnitude
 *  blows out toward white the way an overdriven meter does, which is what
 *  gives a spectrum/spectrogram that glowing, hot-core look instead of
 *  reading as flat colored blocks. */
function hotColor(dim: string, tagColor: string, magnitude: number): string {
  const clamped = Math.min(1, Math.max(0, magnitude))
  if (clamped < 0.7) return mixColor(dim, tagColor, clamped / 0.7)
  return mixColor(tagColor, '#ffffff', (clamped - 0.7) / 0.3)
}

/** Bucket the usable frequency range into SPECTRUM_BAR_COUNT bars, each the
 *  average of its slice of bins — raw per-bin bars at this width would be
 *  thinner than a pixel and read as noise. Each bar's color comes from the
 *  same tag color-wheel the reactive ring uses, always at full strength
 *  (blue fallback only when the track has no tags) — this doesn't fade via
 *  the waveform intensity slider, which is scoped to the waveform panel.
 *
 *  Both this and drawSpectrogramColumn read theme tokens fresh on every draw.
 *  While playing that's every frame; while paused the spectrum is drawn once,
 *  and the active theme is in the effect deps so a theme switch repaints it. */
/** Sizes a canvas's backing store for the current DPR — only when it actually
 *  changes. Resetting canvas.width every frame reallocates the backing store 60
 *  times a second, which was a large share of the app's GPU load during playback. */
function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(PANEL_WIDTH * dpr)
  const h = Math.round(PANEL_HEIGHT * dpr)
  if (canvas.width === w && canvas.height === h) return
  canvas.width = w
  canvas.height = h
  canvas.style.width = `${PANEL_WIDTH}px`
  canvas.style.height = `${PANEL_HEIGHT}px`
}

function drawSpectrum(canvas: HTMLCanvasElement, data: Uint8Array | null, tagColors: string[]): void {
  const dpr = window.devicePixelRatio || 1
  fitCanvas(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT)

  const dim = themeColor('--analyzer-bar-dim')
  const fallback = themeColor('--screen-accent')
  const barWidth = (PANEL_WIDTH - BAR_GAP * (SPECTRUM_BAR_COUNT - 1)) / SPECTRUM_BAR_COUNT
  const binsPerBar = Math.max(1, Math.floor(USABLE_BINS / SPECTRUM_BAR_COUNT))

  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
    let sum = 0
    if (data) {
      const start = i * binsPerBar
      for (let b = 0; b < binsPerBar; b++) sum += data[start + b] ?? 0
      sum /= binsPerBar
    }
    // Square-root compression so quiet content still shows a visible bar
    // instead of the whole panel reading near-empty most of the time.
    const magnitude = Math.sqrt(sum / 255)
    const barHeight = Math.max(2, magnitude * PANEL_HEIGHT)
    const color = tagColorForSlot(i, SPECTRUM_BAR_COUNT, tagColors, fallback)
    const x = i * (barWidth + BAR_GAP)
    const y = PANEL_HEIGHT - barHeight

    ctx.fillStyle = hotColor(dim, color, magnitude)
    ctx.beginPath()
    ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2, barWidth / 2, 0, 0])
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

/** Draws one new column into the offscreen history buffer (integer pixels,
 *  scroll-safe — see SPECTROGRAM_BUFFER_WIDTH's note), then blits the whole
 *  buffer onto the visible canvas scaled to fit. Each frequency row's "hot"
 *  color comes from the same tag color-wheel as the spectrum bars, so the
 *  heatmap reads in the track's own tag colors instead of one flat accent —
 *  same always-full-strength rule as the other panels. */
function drawSpectrogramColumn(
  visibleCanvas: HTMLCanvasElement,
  buffer: HTMLCanvasElement,
  data: Uint8Array | null,
  tagColors: string[]
): void {
  const bufferCtx = buffer.getContext('2d')
  const visibleCtx = visibleCanvas.getContext('2d')
  if (!bufferCtx || !visibleCtx) return

  const w = SPECTROGRAM_BUFFER_WIDTH
  const h = SPECTROGRAM_BUFFER_HEIGHT

  bufferCtx.drawImage(buffer, -1, 0)

  const dim = themeColor('--analyzer-bg-dim')
  const fallback = themeColor('--screen-accent-strong')
  const binsPerPixel = Math.max(1, Math.floor(USABLE_BINS / h))

  for (let y = 0; y < h; y++) {
    let sum = 0
    if (data) {
      // Low frequencies at the bottom, high at the top, like a real spectrogram.
      const start = Math.floor(((h - 1 - y) / h) * USABLE_BINS)
      for (let b = 0; b < binsPerPixel; b++) sum += data[start + b] ?? 0
      sum /= binsPerPixel
    }
    const magnitude = Math.sqrt(sum / 255)
    // y=0 is the top (high frequencies) — walk the color wheel top-to-bottom
    // so it reads the same visual direction as the spectrum bars left-to-right.
    const tagColor = tagColorForSlot(h - 1 - y, h, tagColors, fallback)
    bufferCtx.fillStyle = hotColor(dim, tagColor, magnitude)
    bufferCtx.fillRect(w - 1, y, 1, 1)
  }

  fitCanvas(visibleCanvas)
  visibleCtx.imageSmoothingEnabled = false
  visibleCtx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height)
  visibleCtx.drawImage(buffer, 0, 0, w, h, 0, 0, visibleCanvas.width, visibleCanvas.height)
}

function AudioAnalyzerPanels({ track }: { track: Track | null }): React.JSX.Element | null {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const tagColors = useTrackTagColors(track?.id)
  const theme = useThemeStore((s) => s.theme)
  const spectrumRef = useRef<HTMLCanvasElement>(null)
  const spectrogramRef = useRef<HTMLCanvasElement>(null)
  const spectrogramBufferRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!spectrogramBufferRef.current) {
      const buffer = document.createElement('canvas')
      buffer.width = SPECTROGRAM_BUFFER_WIDTH
      buffer.height = SPECTROGRAM_BUFFER_HEIGHT
      spectrogramBufferRef.current = buffer
    }
  }, [])

  // Animates only while playing. Paused, the spectrum is drawn once at rest and
  // the spectrogram simply holds its history, instead of redrawing an unchanging
  // picture 60 times a second.
  useEffect(() => {
    if (!track) return
    if (!isPlaying) {
      if (spectrumRef.current) drawSpectrum(spectrumRef.current, null, tagColors)
      return
    }
    return startVisualLoop(() => {
      const data = audioEngine.getHiResFrequencyData()
      if (spectrumRef.current) drawSpectrum(spectrumRef.current, data, tagColors)
      if (spectrogramRef.current && spectrogramBufferRef.current) {
        drawSpectrogramColumn(spectrogramRef.current, spectrogramBufferRef.current, data, tagColors)
      }
    })
  }, [track, isPlaying, tagColors, theme])

  if (!track) return null

  return (
    <div className={styles.wrap}>
      <canvas ref={spectrumRef} className={styles.panel} title="Spectrum analyzer" />
      <canvas ref={spectrogramRef} className={styles.panel} title="Spectrogram" />
    </div>
  )
}

export default AudioAnalyzerPanels
