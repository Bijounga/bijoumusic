import { create } from 'zustand'
import type { TagGroup, Tag } from '@shared/types'

interface TagState {
  groups: TagGroup[]
  tags: Tag[]
  /** trackId -> Set of tagIds, built from every track_tags row in one shot. */
  trackTags: Map<number, Set<number>>
  loadAll: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: number, name: string) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  createTag: (name: string, groupId: number | null) => Promise<Tag>
  renameTag: (id: number, name: string) => Promise<void>
  reorderTags: (orderedIds: number[]) => Promise<void>
  moveTagToGroup: (id: number, groupId: number | null) => Promise<void>
  deleteTag: (id: number) => Promise<void>
  addTrackTag: (trackId: number, tagId: number) => Promise<void>
  removeTrackTag: (trackId: number, tagId: number) => Promise<void>
}

export const useTagStore = create<TagState>((set, get) => ({
  groups: [],
  tags: [],
  trackTags: new Map(),

  loadAll: async () => {
    const [groups, tags, assignments] = await Promise.all([
      window.api.listTagGroups(),
      window.api.listTags(),
      window.api.listAllTrackTagAssignments()
    ])
    const trackTags = new Map<number, Set<number>>()
    for (const a of assignments) {
      if (!trackTags.has(a.trackId)) trackTags.set(a.trackId, new Set())
      trackTags.get(a.trackId)!.add(a.tagId)
    }
    set({ groups, tags, trackTags })
  },

  createGroup: async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await window.api.createTagGroup(trimmed)
    await get().loadAll()
  },

  renameGroup: async (id: number, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await window.api.renameTagGroup(id, trimmed)
    await get().loadAll()
  },

  deleteGroup: async (id: number) => {
    await window.api.deleteTagGroup(id)
    await get().loadAll()
  },

  createTag: async (name: string, groupId: number | null) => {
    const tag = await window.api.createTag(name.trim(), groupId)
    await get().loadAll()
    return tag
  },

  renameTag: async (id: number, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await window.api.renameTag(id, trimmed)
    await get().loadAll()
  },

  // Applies the new order to local state immediately (a drag-drop feels wrong if it
  // snaps back while waiting on the round-trip) and persists in the background —
  // reordering never invalidates anything else loadAll() would refetch.
  reorderTags: async (orderedIds: number[]) => {
    const newIndex = new Map(orderedIds.map((id, i) => [id, i]))
    const reordered = [...get().tags].sort((a, b) => {
      const ai = newIndex.get(a.id)
      const bi = newIndex.get(b.id)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return 0
    })
    set({ tags: reordered })
    await window.api.reorderTags(orderedIds)
  },

  moveTagToGroup: async (id: number, groupId: number | null) => {
    await window.api.moveTagToGroup(id, groupId)
    await get().loadAll()
  },

  deleteTag: async (id: number) => {
    await window.api.deleteTag(id)
    await get().loadAll()
  },

  addTrackTag: async (trackId: number, tagId: number) => {
    await window.api.addTrackTag(trackId, tagId)
    const trackTags = new Map(get().trackTags)
    const set_ = new Set(trackTags.get(trackId))
    set_.add(tagId)
    trackTags.set(trackId, set_)
    set({ trackTags })
  },

  removeTrackTag: async (trackId: number, tagId: number) => {
    await window.api.removeTrackTag(trackId, tagId)
    const trackTags = new Map(get().trackTags)
    const set_ = new Set(trackTags.get(trackId))
    set_.delete(tagId)
    trackTags.set(trackId, set_)
    set({ trackTags })
  }
}))
