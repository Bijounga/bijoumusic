import tahoeDay from '../assets/glass/glass-tahoe-day.webp'
import tahoeSunset from '../assets/glass/glass-tahoe-sunset.webp'
import tahoeDusk from '../assets/glass/glass-tahoe-dusk.webp'
import tahoeWinter from '../assets/glass/glass-tahoe-winter.webp'
import yosemite from '../assets/glass/glass-yosemite.webp'
import yosemiteFog from '../assets/glass/glass-yosemite-fog.webp'
import bigSur from '../assets/glass/glass-big-sur.webp'
import wave from '../assets/glass/glass-wave.webp'
import tide from '../assets/glass/glass-abstract-tide.webp'
import bloom from '../assets/glass/glass-abstract-bloom.webp'
import pearl from '../assets/glass/glass-abstract-pearl.webp'
import aurora from '../assets/glass/glass-abstract-aurora.webp'
import tahoeDayThumb from '../assets/glass/thumbs/glass-tahoe-day.webp'
import tahoeSunsetThumb from '../assets/glass/thumbs/glass-tahoe-sunset.webp'
import tahoeDuskThumb from '../assets/glass/thumbs/glass-tahoe-dusk.webp'
import tahoeWinterThumb from '../assets/glass/thumbs/glass-tahoe-winter.webp'
import yosemiteThumb from '../assets/glass/thumbs/glass-yosemite.webp'
import yosemiteFogThumb from '../assets/glass/thumbs/glass-yosemite-fog.webp'
import bigSurThumb from '../assets/glass/thumbs/glass-big-sur.webp'
import waveThumb from '../assets/glass/thumbs/glass-wave.webp'
import tideThumb from '../assets/glass/thumbs/glass-abstract-tide.webp'
import bloomThumb from '../assets/glass/thumbs/glass-abstract-bloom.webp'
import pearlThumb from '../assets/glass/thumbs/glass-abstract-pearl.webp'
import auroraThumb from '../assets/glass/thumbs/glass-abstract-aurora.webp'

// Everything the Liquid Glass themes need to know that isn't plain CSS: which pictures
// can sit behind the glass, and how the two settings (Frost, wallpaper) become CSS
// variables. Kept free of zustand so main.tsx can apply it before first paint.

export interface GlassWallpaper {
  id: string
  label: string
  url: string
  thumb: string
}

/** Photos first, then the abstracts. The first one is the fallback for a saved id that no longer exists. */
export const GLASS_WALLPAPERS: GlassWallpaper[] = [
  { id: 'glass-tahoe-day', label: 'Emerald Bay', url: tahoeDay, thumb: tahoeDayThumb },
  { id: 'glass-tahoe-sunset', label: 'Tahoe sunset', url: tahoeSunset, thumb: tahoeSunsetThumb },
  { id: 'glass-tahoe-dusk', label: 'Tahoe dusk', url: tahoeDusk, thumb: tahoeDuskThumb },
  { id: 'glass-tahoe-winter', label: 'Tahoe winter', url: tahoeWinter, thumb: tahoeWinterThumb },
  { id: 'glass-yosemite', label: 'Yosemite', url: yosemite, thumb: yosemiteThumb },
  { id: 'glass-yosemite-fog', label: 'Yosemite fog', url: yosemiteFog, thumb: yosemiteFogThumb },
  { id: 'glass-big-sur', label: 'Big Sur', url: bigSur, thumb: bigSurThumb },
  { id: 'glass-wave', label: 'Wave', url: wave, thumb: waveThumb },
  { id: 'glass-abstract-tide', label: 'Tide', url: tide, thumb: tideThumb },
  { id: 'glass-abstract-bloom', label: 'Bloom', url: bloom, thumb: bloomThumb },
  { id: 'glass-abstract-pearl', label: 'Pearl', url: pearl, thumb: pearlThumb },
  { id: 'glass-abstract-aurora', label: 'Aurora', url: aurora, thumb: auroraThumb }
]

export const FROST_KEY = 'bijoumusic:glass-frost'
export const WALLPAPER_KEY = 'bijoumusic:glass-wallpaper'
export const DEFAULT_FROST = 60

export function isGlassTheme(themeId: string | undefined): boolean {
  return themeId !== undefined && themeId.startsWith('liquid-glass')
}

/** Dark glass starts on a darker picture; the light one on the brightest. */
function defaultWallpaperId(themeId: string | undefined): string {
  return themeId === 'liquid-glass-dark' ? 'glass-tahoe-sunset' : 'glass-tahoe-day'
}

export function readFrost(): number {
  try {
    const raw = localStorage.getItem(FROST_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : DEFAULT_FROST
  } catch {
    return DEFAULT_FROST
  }
}

/** The saved picture's id, or null when none was ever chosen (so the theme's own default applies). */
export function readWallpaperId(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_KEY)
  } catch {
    return null
  }
}

export function resolveWallpaper(savedId: string | null, themeId: string | undefined): GlassWallpaper {
  const id = savedId ?? defaultWallpaperId(themeId)
  return GLASS_WALLPAPERS.find((w) => w.id === id) ?? GLASS_WALLPAPERS[0]
}

/** Writes the Frost level and the picture onto <html> as the CSS variables the glass themes read. */
export function applyGlassVars(frost = readFrost(), savedWallpaperId = readWallpaperId()): void {
  const root = document.documentElement
  const wallpaper = resolveWallpaper(savedWallpaperId, root.dataset.theme)
  root.style.setProperty('--lg-frost', String(frost))
  root.style.setProperty('--lg-wallpaper', `url("${wallpaper.url}")`)
}
