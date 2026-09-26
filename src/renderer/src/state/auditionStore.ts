import { create } from 'zustand'

interface AuditionState {
  /** Rapid audition mode: while on, each track auto-advances to the next after a
   *  few seconds, so you can skim a long list quickly instead of playing each one
   *  through. */
  enabled: boolean
  toggle: () => void
}

export const useAuditionStore = create<AuditionState>((set, get) => ({
  enabled: false,
  toggle: () => set({ enabled: !get().enabled })
}))
