import { create } from 'zustand'

interface SelectionState {
  selectedIds: Set<number>
  /** The row a shift-click range is measured from — stays put across repeated
   *  shift-clicks so extending/shrinking a range always references the same start,
   *  the way file explorers behave. Reset on a plain click or a ctrl/cmd-click. */
  anchorId: number | null
  clear: () => void
  selectOnly: (id: number) => void
  toggle: (id: number) => void
  selectRange: (toId: number, orderedIds: number[]) => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),
  anchorId: null,

  clear: () => set({ selectedIds: new Set(), anchorId: null }),

  selectOnly: (id) => set({ selectedIds: new Set([id]), anchorId: id }),

  toggle: (id) => {
    const next = new Set(get().selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ selectedIds: next, anchorId: id })
  },

  selectRange: (toId, orderedIds) => {
    const anchorId = get().anchorId ?? toId
    const fromIndex = orderedIds.indexOf(anchorId)
    const toIndex = orderedIds.indexOf(toId)
    if (fromIndex === -1 || toIndex === -1) {
      set({ selectedIds: new Set([toId]), anchorId: toId })
      return
    }
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    set({ selectedIds: new Set(orderedIds.slice(start, end + 1)) })
  }
}))
