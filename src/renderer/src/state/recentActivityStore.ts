import { create } from 'zustand'

interface RecentActivityState {
  recentlyPlayedIds: number[]
  mostUsedIds: number[]
  loadRecentlyPlayed: () => Promise<void>
  loadMostUsed: () => Promise<void>
}

export const useRecentActivityStore = create<RecentActivityState>((set) => ({
  recentlyPlayedIds: [],
  mostUsedIds: [],

  loadRecentlyPlayed: async () => {
    const ids = await window.api.getRecentlyPlayed()
    set({ recentlyPlayedIds: ids })
  },

  loadMostUsed: async () => {
    const ids = await window.api.getMostUsed()
    set({ mostUsedIds: ids })
  }
}))
