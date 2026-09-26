import { create } from 'zustand'
import { useSearchBlacklistStore } from './searchBlacklistStore'

export interface FolderSelection {
  libraryRootId: number
  /** '' selects the whole root; otherwise a folderPath-relative segment path within it. */
  relativePath: string
}

export type ActiveView = 'library' | 'recentlyPlayed' | 'mostUsed' | 'project' | 'duplicates' | 'similar'

interface FilterState {
  activeView: ActiveView
  selectedProjectId: number | null
  selectedFolder: FolderSelection | null
  selectedTagIds: number[]
  selectedFavoriteLevel: number | null
  selectedEnergyLevel: number | null
  searchQuery: string
  /** Both null = no duration filter. Either bound can be set independently
   *  (e.g. "under 2 minutes" is just a max with no min). */
  minDurationSeconds: number | null
  maxDurationSeconds: number | null
  setActiveView: (view: ActiveView) => void
  setActiveProject: (projectId: number) => void
  setSelectedFolder: (folder: FolderSelection | null) => void
  toggleTag: (tagId: number) => void
  selectOnlyTag: (tagId: number) => void
  clearTags: () => void
  toggleFavoriteLevel: (level: number) => void
  toggleEnergyLevel: (level: number) => void
  setSearchQuery: (query: string) => void
  setDurationRange: (min: number | null, max: number | null) => void
  clearAllFilters: () => void
}

export const useFilterStore = create<FilterState>((set, get) => ({
  activeView: 'library',
  selectedProjectId: null,
  selectedFolder: null,
  selectedTagIds: [],
  selectedFavoriteLevel: null,
  selectedEnergyLevel: null,
  searchQuery: '',
  minDurationSeconds: null,
  maxDurationSeconds: null,
  // Recently Played / Most Used / a Project are each a distinct "view" of the whole
  // library, not a filter combinable with a folder — picking one clears the others,
  // same as clicking a folder while a view is active switches back to normal browsing.
  setActiveView: (view) => set({ activeView: view, selectedFolder: null, selectedProjectId: null }),
  setActiveProject: (projectId) => set({ activeView: 'project', selectedFolder: null, selectedProjectId: projectId }),
  setSelectedFolder: (folder) => set({ selectedFolder: folder, activeView: 'library', selectedProjectId: null }),
  toggleTag: (tagId) => {
    const current = get().selectedTagIds
    set({
      selectedTagIds: current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    })
  },
  // Plain click on a tag: switch the filter to just this tag, or clear it if
  // this tag was already the sole selection (so a second click toggles off).
  selectOnlyTag: (tagId) => {
    const current = get().selectedTagIds
    const isOnlySelected = current.length === 1 && current[0] === tagId
    set({ selectedTagIds: isOnlySelected ? [] : [tagId] })
  },
  clearTags: () => set({ selectedTagIds: [] }),
  toggleFavoriteLevel: (level) => {
    set({ selectedFavoriteLevel: get().selectedFavoriteLevel === level ? null : level })
  },
  toggleEnergyLevel: (level) => {
    set({ selectedEnergyLevel: get().selectedEnergyLevel === level ? null : level })
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setDurationRange: (min, max) => set({ minDurationSeconds: min, maxDurationSeconds: max }),
  clearAllFilters: () => {
    useSearchBlacklistStore.getState().clearAll()
    set({
      activeView: 'library',
      selectedProjectId: null,
      selectedFolder: null,
      selectedTagIds: [],
      selectedFavoriteLevel: null,
      selectedEnergyLevel: null,
      searchQuery: '',
      minDurationSeconds: null,
      maxDurationSeconds: null
    })
  }
}))
