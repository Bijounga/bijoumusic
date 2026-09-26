import { create } from 'zustand'
import type { Track } from '@shared/types'

interface DuplicateState {
  /** Each inner array is a group of tracks sharing a content hash — the same audio
   *  scanned from two different files, not a move/rename. */
  groups: Track[][]
  loadDuplicates: () => Promise<void>
}

export const useDuplicateStore = create<DuplicateState>((set) => ({
  groups: [],
  loadDuplicates: async () => {
    const groups = await window.api.listDuplicateGroups()
    set({ groups })
  }
}))
