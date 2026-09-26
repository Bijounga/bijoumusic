import { create } from 'zustand'
import type { TrackRating } from '@shared/types'

interface RatingState {
  ratings: Map<number, TrackRating>
  loadAll: () => Promise<void>
  setFavoriteLevel: (trackId: number, level: number | null) => Promise<void>
  setEnergyLevel: (trackId: number, level: number | null) => Promise<void>
}

export const useRatingStore = create<RatingState>((set, get) => ({
  ratings: new Map(),

  loadAll: async () => {
    const ratings = await window.api.listAllRatings()
    set({ ratings: new Map(ratings.map((r) => [r.trackId, r])) })
  },

  setFavoriteLevel: async (trackId: number, level: number | null) => {
    await window.api.setFavoriteLevel(trackId, level)
    const ratings = new Map(get().ratings)
    const existing = ratings.get(trackId) ?? { trackId, favoriteLevel: null, energyLevel: null }
    ratings.set(trackId, { ...existing, favoriteLevel: level })
    set({ ratings })
  },

  setEnergyLevel: async (trackId: number, level: number | null) => {
    await window.api.setEnergyLevel(trackId, level)
    const ratings = new Map(get().ratings)
    const existing = ratings.get(trackId) ?? { trackId, favoriteLevel: null, energyLevel: null }
    ratings.set(trackId, { ...existing, energyLevel: level })
    set({ ratings })
  }
}))
