import { create } from 'zustand'

interface UiSignalState {
  /** Bumped to request the Now Playing bar's alias editor open + focus its input —
   *  a counter rather than a boolean so firing it twice in a row (without anything
   *  else changing in between) still triggers a fresh effect each time. */
  openAliasEditorSignal: number
  requestOpenAliasEditor: () => void
  /** Same counter pattern, for the "Download to library" modal — AppShell owns
   *  the modal's actual open/closed state, but the keybind handler doesn't have
   *  access to that local state, so it signals through here instead. */
  openDownloadModalSignal: number
  requestOpenDownloadModal: () => void
}

export const useUiSignalStore = create<UiSignalState>((set, get) => ({
  openAliasEditorSignal: 0,
  requestOpenAliasEditor: () => set({ openAliasEditorSignal: get().openAliasEditorSignal + 1 }),
  openDownloadModalSignal: 0,
  requestOpenDownloadModal: () => set({ openDownloadModalSignal: get().openDownloadModalSignal + 1 })
}))
