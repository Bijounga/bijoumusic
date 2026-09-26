import { create } from 'zustand'
import type { Alias } from '@shared/types'

interface AliasState {
  /** trackId -> its aliases */
  aliasesByTrack: Map<number, Alias[]>
  loadAll: () => Promise<void>
  addAlias: (trackId: number, aliasText: string) => Promise<void>
  deleteAlias: (id: number, trackId: number) => Promise<void>
}

export const useAliasStore = create<AliasState>((set, get) => ({
  aliasesByTrack: new Map(),

  loadAll: async () => {
    const aliases = await window.api.listAllAliases()
    const map = new Map<number, Alias[]>()
    for (const alias of aliases) {
      if (!map.has(alias.trackId)) map.set(alias.trackId, [])
      map.get(alias.trackId)!.push(alias)
    }
    set({ aliasesByTrack: map })
  },

  addAlias: async (trackId: number, aliasText: string) => {
    const trimmed = aliasText.trim()
    if (!trimmed) return
    const alias = await window.api.addAlias(trackId, trimmed)
    const aliasesByTrack = new Map(get().aliasesByTrack)
    aliasesByTrack.set(trackId, [...(aliasesByTrack.get(trackId) ?? []), alias])
    set({ aliasesByTrack })
  },

  deleteAlias: async (id: number, trackId: number) => {
    await window.api.deleteAlias(id)
    const aliasesByTrack = new Map(get().aliasesByTrack)
    aliasesByTrack.set(trackId, (aliasesByTrack.get(trackId) ?? []).filter((a) => a.id !== id))
    set({ aliasesByTrack })
  }
}))
