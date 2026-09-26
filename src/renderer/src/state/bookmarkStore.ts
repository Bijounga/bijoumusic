import { create } from 'zustand'
import type { TrackBookmark } from '@shared/types'

interface BookmarkState {
  /** trackId -> its bookmarks, ordered by position. */
  bookmarksByTrack: Map<number, TrackBookmark[]>
  loadAll: () => Promise<void>
  addBookmark: (trackId: number, positionSeconds: number, label: string | null) => Promise<void>
  deleteBookmark: (id: number, trackId: number) => Promise<void>
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarksByTrack: new Map(),

  loadAll: async () => {
    const bookmarks = await window.api.listAllBookmarks()
    const map = new Map<number, TrackBookmark[]>()
    for (const b of bookmarks) {
      if (!map.has(b.trackId)) map.set(b.trackId, [])
      map.get(b.trackId)!.push(b)
    }
    for (const list of map.values()) list.sort((a, b) => a.positionSeconds - b.positionSeconds)
    set({ bookmarksByTrack: map })
  },

  addBookmark: async (trackId, positionSeconds, label) => {
    const bookmark = await window.api.addBookmark(trackId, positionSeconds, label)
    const bookmarksByTrack = new Map(get().bookmarksByTrack)
    const next = [...(bookmarksByTrack.get(trackId) ?? []), bookmark].sort(
      (a, b) => a.positionSeconds - b.positionSeconds
    )
    bookmarksByTrack.set(trackId, next)
    set({ bookmarksByTrack })
  },

  deleteBookmark: async (id, trackId) => {
    await window.api.deleteBookmark(id)
    const bookmarksByTrack = new Map(get().bookmarksByTrack)
    bookmarksByTrack.set(trackId, (bookmarksByTrack.get(trackId) ?? []).filter((b) => b.id !== id))
    set({ bookmarksByTrack })
  }
}))
