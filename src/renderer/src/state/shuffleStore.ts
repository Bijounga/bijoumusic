import { create } from 'zustand'
import type { Track } from '@shared/types'
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
  /** Stack of tracks left behind while shuffling forward, most-recent last. Since
   *  shuffle deliberately ignores the visible list's order going forward, stepping
   *  backward through that same order (as non-shuffle "previous" does) would land
   *  on an unrelated track instead of retracing actual playback history — this
   *  stack is what "previous" pops from instead, in useTransportControls. Lives
   *  here rather than as local hook state since next/previous are called from
   *  several independent places (the bottom bar, media keys, autoplay). */
  history: Track[]
  pushHistory: (track: Track) => void
  popHistory: () => Track | undefined
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
    // Stale history from a previous shuffle session would otherwise resurface
    // confusingly if shuffle gets turned back on later.
    set({ enabled, history: [] })
  },
  history: [],
  pushHistory: (track) => set({ history: [...get().history, track] }),
  popHistory: () => {
    const history = get().history
    if (history.length === 0) return undefined
    const last = history[history.length - 1]
    set({ history: history.slice(0, -1) })
    return last
  }
}))
