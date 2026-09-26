import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

export type SortBy = 'folder' | 'name' | 'recentlyAdded'
export type SortDirection = 'asc' | 'desc'

const STORAGE_KEY = 'bijoumusic:sort'

interface StoredSort {
  sortBy: SortBy
  sortDirection: SortDirection
}

function load(): StoredSort {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sortBy: 'folder', sortDirection: 'asc' }
    return JSON.parse(raw) as StoredSort
  } catch {
    return { sortBy: 'folder', sortDirection: 'asc' }
  }
}

function save(value: StoredSort): void {
  try {
    setSetting(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Non-fatal — worst case the sort preference doesn't survive a restart.
  }
}

interface SortState {
  sortBy: SortBy
  sortDirection: SortDirection
  setSortBy: (sortBy: SortBy) => void
  toggleSortDirection: () => void
}

export const useSortStore = create<SortState>((set, get) => {
  const initial = load()
  return {
    sortBy: initial.sortBy,
    sortDirection: initial.sortDirection,

    setSortBy: (sortBy) => {
      save({ sortBy, sortDirection: get().sortDirection })
      set({ sortBy })
    },

    toggleSortDirection: () => {
      const next = get().sortDirection === 'asc' ? 'desc' : 'asc'
      save({ sortBy: get().sortBy, sortDirection: next })
      set({ sortDirection: next })
    }
  }
})
