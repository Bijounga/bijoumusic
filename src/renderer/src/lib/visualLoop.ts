// Shared pacing for every always-moving visual (waveform playhead, progress ring,
// reactive ring, spectrum/spectrogram). requestAnimationFrame fires at the display's
// refresh rate — 144Hz+ on many monitors — and each visual update makes the GPU
// recompose the whole window. Capping updates at 30 per second still looks smooth
// for meters and a playhead, and cut the app's playback CPU dramatically.

const VISUAL_FPS = 30
const FRAME_MS = 1000 / VISUAL_FPS

/** Calls `draw` at most VISUAL_FPS times a second, on animation frames. Returns a
 *  stop function. Frames in between do nothing, so they produce no new picture. */
export function startVisualLoop(draw: () => void): () => void {
  let rafId = 0
  let last = 0
  const tick = (now: number): void => {
    // Small tolerance so a 60Hz display lands every other frame instead of drifting.
    if (now - last >= FRAME_MS - 2) {
      last = now
      draw()
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(rafId)
}

// Theme colors read via getComputedStyle force a style recalculation when anything
// on the page changed since the last read — which, during playback, is every
// frame. Theme tokens only change when the theme does, so cache them per theme.
let cachedTheme: string | undefined
const colorCache = new Map<string, string>()

export function cachedThemeColor(cssVar: string): string {
  const theme = document.documentElement.dataset.theme
  if (theme !== cachedTheme) {
    colorCache.clear()
    cachedTheme = theme
  }
  let color = colorCache.get(cssVar)
  if (color === undefined) {
    color = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    colorCache.set(cssVar, color)
  }
  return color
}
