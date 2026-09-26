import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

export type CustomKeybindAction =
  | 'clearTags'
  | 'clearAllFilters'
  | 'jumpToFolder'
  | 'focusAliasInput'
  | 'applyTag'
  | 'clearTrackTags'
  | 'shuffle'
  | 'toggleShuffleMode'
  | 'toggleAutoplay'
  | 'openDownloadModal'
  | 'setPreviewStart'
  | 'setPreviewEnd'
  | 'toggleDrawRange'

export interface CustomKeybind {
  id: string
  key: string // KeyboardEvent.code
  action: CustomKeybindAction
  label: string
  folderLibraryRootId?: number
  folderRelativePath?: string
  tagId?: number
}

const STORAGE_KEY = 'bijoumusic:custom-keybinds'

function load(): CustomKeybind[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CustomKeybind[]) : []
  } catch {
    return []
  }
}

function save(binds: CustomKeybind[]): void {
  try {
    setSetting(STORAGE_KEY, JSON.stringify(binds))
  } catch {
    // Non-fatal — worst case the custom binds don't survive a restart.
  }
}

interface KeybindState {
  binds: CustomKeybind[]
  /** True while the Keybinds wizard is waiting for a keypress to assign — every
   *  other global shortcut handler (fixed shortcuts, other custom binds) checks
   *  this and skips itself, so e.g. pressing Space to bind "Space" doesn't also
   *  toggle playback. */
  isCapturingKeybind: boolean
  setCapturingKeybind: (capturing: boolean) => void
  addBind: (bind: Omit<CustomKeybind, 'id'>) => void
  removeBind: (id: string) => void
  rebindKey: (id: string, newKey: string) => void
}

export const useKeybindStore = create<KeybindState>((set, get) => ({
  binds: load(),
  isCapturingKeybind: false,
  setCapturingKeybind: (capturing) => set({ isCapturingKeybind: capturing }),

  addBind: (bind) => {
    const withId: CustomKeybind = { ...bind, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
    const next = [...get().binds, withId]
    save(next)
    set({ binds: next })
  },

  removeBind: (id) => {
    const next = get().binds.filter((b) => b.id !== id)
    save(next)
    set({ binds: next })
  },

  rebindKey: (id, newKey) => {
    const next = get().binds.map((b) => (b.id === id ? { ...b, key: newKey } : b))
    save(next)
    set({ binds: next })
  }
}))
