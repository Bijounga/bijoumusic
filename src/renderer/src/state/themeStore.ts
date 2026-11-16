import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'
import { applyGlassVars } from '../lib/glass'

// Grows as each theme actually ships (see the theming plan) — only list a theme
// id here once its styles/themes/*.css file is real, or the switcher would offer
// something with no styling behind it.
export type ThemeId =
  | 'dark'
  | 'frutiger-luna'
  | 'frutiger-aero-dark'
  | 'frutiger-aqua'
  | 'vaporwave-95'
  | 'y2k-chrome'
  | 'liquid-glass'
  | 'liquid-glass-dark'
  | 'soft-3d'
  | 'soft-3d-dark'
  | 'techno-flat'
const KNOWN_THEMES: ThemeId[] = [
  'dark',
  'frutiger-luna',
  'frutiger-aero-dark',
  'frutiger-aqua',
  'vaporwave-95',
  'y2k-chrome',
  'liquid-glass',
  'liquid-glass-dark',
  'soft-3d',
  'soft-3d-dark',
  'techno-flat'
]
const DEFAULT_THEME: ThemeId = 'dark'

const STORAGE_KEY = 'bijoumusic:theme'

function isThemeId(value: string): value is ThemeId {
  return (KNOWN_THEMES as string[]).includes(value)
}

function load(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw && isThemeId(raw) ? raw : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function save(id: ThemeId): void {
  try {
    setSetting(STORAGE_KEY, id)
  } catch {
    // Non-fatal — worst case the theme choice doesn't survive a restart.
  }
}

/** The one place that actually paints the theme — every theme's CSS is scoped to
 *  html[data-theme="x"] (styles/themes/*.css), so switching is just this one
 *  attribute write. Exported standalone (not only via the store) so main.tsx can
 *  apply the saved theme synchronously before React/zustand are even loaded,
 *  avoiding a flash of the default theme on startup. */
export function applyThemeAttribute(id: ThemeId): void {
  document.documentElement.dataset.theme = id
  // The glass themes' default picture depends on which one is active.
  applyGlassVars()
}

interface ThemeState {
  theme: ThemeId
  setTheme: (id: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: load(),
  setTheme: (id) => {
    save(id)
    applyThemeAttribute(id)
    set({ theme: id })
  }
}))
