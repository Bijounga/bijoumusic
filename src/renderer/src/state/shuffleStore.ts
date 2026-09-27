import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

const STORAGE_KEY = 'bijoumusic:shuffle-mode'

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

interface ShuffleState {
  /** Shuffle mode — while on, Next (and autoplay advancing at the end of a track)
   *  picks a random track from the visible list instead of stepping sequentially.
   *  Separate from the one-off "play something random right now" dice button/keybind. */
  enabled: boolean
  toggle: () => void
}

export const useShuffleStore = create<ShuffleState>((set, get) => ({
  enabled: load(),
  toggle: () => {
    const enabled = !get().enabled
    try {
      setSetting(STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Non-fatal — worst case the preference doesn't survive a restart.
    }
    set({ enabled })
  }
}))
