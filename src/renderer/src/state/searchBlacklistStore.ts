import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

const STORAGE_KEY = 'bijoumusic:search-blacklist'

export interface BlacklistedFolder {
  libraryRootId: number
  relativePath: string
  label: string
}

interface StoredBlacklist {
  words: string[]
  folders: BlacklistedFolder[]
}

function load(): StoredBlacklist {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { words: [], folders: [] }
    const parsed = JSON.parse(raw) as Partial<StoredBlacklist>
    return { words: parsed.words ?? [], folders: parsed.folders ?? [] }
  } catch {
    return { words: [], folders: [] }
  }
}

function save(state: StoredBlacklist): void {
  try {
    setSetting(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Non-fatal — worst case the blacklist doesn't survive a restart.
  }
}

interface SearchBlacklistState {
  /** Lowercased words — a track whose filename contains one is excluded from
   *  search results (not from plain folder/tag browsing, which is a deliberate
   *  "show me this folder" action rather than search casting a wide net). */
  words: string[]
  folders: BlacklistedFolder[]
  addWord: (word: string) => void
  removeWord: (word: string) => void
  addFolder: (folder: BlacklistedFolder) => void
  removeFolder: (libraryRootId: number, relativePath: string) => void
  clearAll: () => void
}

export const useSearchBlacklistStore = create<SearchBlacklistState>((set, get) => {
  const initial = load()
  return {
    words: initial.words,
    folders: initial.folders,

    addWord: (word) => {
      const trimmed = word.trim().toLowerCase()
      if (!trimmed || get().words.includes(trimmed)) return
      const words = [...get().words, trimmed]
      save({ words, folders: get().folders })
      set({ words })
    },

    removeWord: (word) => {
      const words = get().words.filter((w) => w !== word)
      save({ words, folders: get().folders })
      set({ words })
    },

    addFolder: (folder) => {
      const exists = get().folders.some(
        (f) => f.libraryRootId === folder.libraryRootId && f.relativePath === folder.relativePath
      )
      if (exists) return
      const folders = [...get().folders, folder]
      save({ words: get().words, folders })
      set({ folders })
    },

    removeFolder: (libraryRootId, relativePath) => {
      const folders = get().folders.filter(
        (f) => !(f.libraryRootId === libraryRootId && f.relativePath === relativePath)
      )
      save({ words: get().words, folders })
      set({ folders })
    },

    clearAll: () => {
      save({ words: [], folders: [] })
      set({ words: [], folders: [] })
    }
  }
})
