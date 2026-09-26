import { create } from 'zustand'

interface ActivePreview {
  trackId: number
  start: number
  end: number
}

interface PreviewClipState {
  /** The clip currently looping (via the waveform popover's "Play preview"
   *  button), or null when nothing's in preview-loop mode. */
  active: ActivePreview | null
  /** While on, dragging on the waveform draws an in/out range instead of scrubbing
   *  playback — a persistent toggle rather than a one-shot mode, so you can mark
   *  ranges on several tracks in a row without re-enabling it each time. */
  isDrawingRange: boolean
  startPreview: (trackId: number, start: number, end: number) => void
  stopPreview: () => void
  toggleDrawingRange: () => void
}

export const usePreviewClipStore = create<PreviewClipState>((set, get) => ({
  active: null,
  isDrawingRange: false,
  startPreview: (trackId, start, end) => set({ active: { trackId, start, end } }),
  stopPreview: () => set({ active: null }),
  toggleDrawingRange: () => set({ isDrawingRange: !get().isDrawingRange })
}))
