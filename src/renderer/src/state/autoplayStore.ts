import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

const STORAGE_KEY = 'bijoumusic:autoplay'

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

interface AutoplayState {
  /** "Keep playing" — when on, reaching the end of a track advances to the next
   *  one (shuffled or sequential, per shuffleStore) instead of just stopping. */
  enabled: boolean
  toggle: () => void
}

export const useAutoplayStore = create<AutoplayState>((set, get) => ({
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
