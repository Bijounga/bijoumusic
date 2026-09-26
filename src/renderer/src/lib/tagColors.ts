// Tags have no per-tag color stored today (the `color` column exists in the DB
// but nothing sets or surfaces it) — so pills get a color deterministically
// derived from the tag's id instead. Same tag always renders the same color
// everywhere it shows up, with zero manual color-picking required. Picked for
// enough hue separation to stay visually distinct even with a couple dozen tags
// on screen at once, and readable as white-on-color text in the dark theme.
//
// Deliberately theme-invariant, not CSS tokens: this palette identifies
// individual TAGS from each other, not the app's visual theme — it should stay
// exactly this set of colors across every theme (dark, Frutiger Aero, etc.), or
// a tag's color would shift on theme switch with nothing else about it changing.
const TAG_PALETTE = [
  '#5b8def', // blue
  '#2fb787', // green
  '#e2574c', // red
  '#e0a52c', // amber
  '#9b6bea', // purple
  '#3fb8c4', // teal
  '#e067a8', // pink
  '#6f9c3f', // olive
  '#ec7d3f', // orange
  '#4f7fd1', // indigo
  '#c5507a', // rose
  '#3fa5e0' // sky
]

export function tagColorForId(tagId: number): string {
  return TAG_PALETTE[Math.abs(tagId) % TAG_PALETTE.length]
}

// Handles the two color formats actually in play here — hex (the tag palette,
// --accent) and rgb/rgba (--waveform-dim, the row waveform's own default gray).
// Falls back to opaque black on anything unrecognized rather than throwing, so a
// theme tweak elsewhere can't take the waveform down with it.
function parseColor(input: string): [number, number, number, number] {
  const hex = input.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = input.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] !== undefined ? Number(rgb[4]) : 1]
  }
  return [0, 0, 0, 1]
}

/** Linear RGBA blend between two CSS colors (hex or rgb/rgba) — t=0 is pure a,
 *  t=1 is pure b. Used to fade a tag color toward the plain default color, which
 *  is what the intensity slider actually controls (not transparency alone — a
 *  transparent bar over a dark background just looks faded/washed out, not "less
 *  colorful"; blending toward the real default color reproduces that look exactly
 *  at t=0). */
export function mixColor(a: string, b: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const [ar, ag, ab, aa] = parseColor(a)
  const [br, bg, bb, ba] = parseColor(b)
  const r = Math.round(ar + (br - ar) * clamped)
  const g = Math.round(ag + (bg - ag) * clamped)
  const bl = Math.round(ab + (bb - ab) * clamped)
  const alpha = aa + (ba - aa) * clamped
  return `rgba(${r}, ${g}, ${bl}, ${alpha.toFixed(3)})`
}

/** Cyclically walks a fixed set of tag colors across a fixed number of slots —
 *  wraps back to the first past the last, so 0 tags is just the fallback, 1 tag
 *  is solid, 2+ reads as a genuine color wheel/spread across the slots rather
 *  than one blended-average hue. Shared by every "spread N tag colors across M
 *  discrete positions" visual (the reactive ring, spectrum bars, spectrogram
 *  frequency rows) so they all agree on the same mapping. */
export function tagColorForSlot(slotIndex: number, totalSlots: number, tagColors: string[], fallback: string): string {
  if (tagColors.length === 0) return fallback
  const fraction = slotIndex / totalSlots
  const scaled = fraction * tagColors.length
  const i = Math.floor(scaled) % tagColors.length
  const next = (i + 1) % tagColors.length
  return tagColors.length === 1 ? tagColors[0] : mixColor(tagColors[i], tagColors[next], scaled - Math.floor(scaled))
}

/** A waveform's fill, built from a track's own tag colors instead of one flat
 *  color — 0 tags falls back to the given default, 1 tag is just that color
 *  solid (a gradient needs at least two stops to mean anything), 2+ spread
 *  evenly left-to-right across the bars. `intensity` (0-1) fades each tag color
 *  toward fallbackColor before building the gradient — 0 reproduces the old
 *  flat-color look exactly, 1 is the full-strength gradient. */
export function waveformFillStyle(
  ctx: CanvasRenderingContext2D,
  width: number,
  tagColors: string[],
  fallbackColor: string,
  intensity = 1
): string | CanvasGradient {
  if (tagColors.length === 0 || intensity <= 0) return fallbackColor
  const blended = tagColors.map((c) => mixColor(fallbackColor, c, intensity))
  if (blended.length === 1) return blended[0]
  const gradient = ctx.createLinearGradient(0, 0, width, 0)
  blended.forEach((color, i) => {
    gradient.addColorStop(i / (blended.length - 1), color)
  })
  return gradient
}
