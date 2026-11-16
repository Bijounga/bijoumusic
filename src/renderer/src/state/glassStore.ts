import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'
import { FROST_KEY, WALLPAPER_KEY, applyGlassVars, readFrost, readWallpaperId } from '../lib/glass'

interface GlassState {
  /** 0 = Clear (almost see-through) … 100 = Frosted. */
  frost: number
  /** The chosen picture, or null for the theme's own default. */
  wallpaperId: string | null
  setFrost: (frost: number) => void
  setWallpaper: (id: string) => void
}

/** The two Liquid Glass settings. Shared by the light and dark glass themes. */
export const useGlassStore = create<GlassState>((set, get) => ({
  frost: readFrost(),
  wallpaperId: readWallpaperId(),

  setFrost: (frost) => {
    try {
      setSetting(FROST_KEY, String(frost))
    } catch {
      // Non-fatal — worst case the level doesn't survive a restart.
    }
    applyGlassVars(frost, get().wallpaperId)
    set({ frost })
  },

  setWallpaper: (id) => {
    try {
      setSetting(WALLPAPER_KEY, id)
    } catch {
      // Non-fatal — worst case the picture doesn't survive a restart.
    }
    applyGlassVars(get().frost, id)
    set({ wallpaperId: id })
  }
}))
