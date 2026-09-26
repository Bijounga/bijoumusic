import { create } from 'zustand'
import type { Track, LibraryRoot, ScanProgressPayload, ScanResult } from '@shared/types'
import { useTagStore } from './tagStore'

interface LibraryState {
  tracks: Track[]
  libraryRoots: LibraryRoot[]
  isLoadingInitial: boolean
  isScanning: boolean
  scanProgress: ScanProgressPayload | null
  scanError: string | null
  loadError: string | null
  /** Brief note shown after a scan that actually imported external (.ts sidecar)
   *  tags — null the rest of the time, including for scans that found nothing to
   *  import, so it doesn't turn into background noise on every periodic rescan. */
  tagImportNote: string | null
  loadInitial: () => Promise<void>
  addFolder: () => Promise<void>
  rescan: (rootPath: string) => Promise<void>
  rescanAll: () => Promise<void>
  rescanFolder: (libraryRootId: number, relativePath: string) => Promise<void>
  setTrackDuration: (trackId: number, durationSeconds: number) => void
  setTrackLoudness: (trackId: number, loudnessRms: number) => void
  setTrackPreviewRange: (trackId: number, start: number | null, end: number | null) => void
  removeTracksLocally: (trackIds: number[]) => void
}

let unsubscribeProgress: (() => void) | null = null

// Shared by rescan (whole root) and rescanFolder (one subfolder) — both go
// through the same progress-subscription/refresh/tag-import-note/error
// handling, differing only in which IPC call actually performs the scan.
async function runScan(
  set: (partial: Partial<LibraryState>) => void,
  get: () => LibraryState,
  performScan: () => Promise<ScanResult>
): Promise<void> {
  if (get().isScanning) return
  set({ isScanning: true, scanError: null, scanProgress: null })

  unsubscribeProgress?.()
  unsubscribeProgress = window.api.onScanProgress((progress) => set({ scanProgress: progress }))

  try {
    const scanResult = await performScan()
    const [tracks, libraryRoots] = await Promise.all([window.api.listTracks(), window.api.listLibraryRoots()])
    set({ tracks, libraryRoots })

    if (scanResult.externalTagsApplied > 0) {
      // The scan just wrote new tags/groups/track_tags rows directly via a
      // separate main-process path (not through tagStore's own IPC methods,
      // which are the only thing that normally invalidates it) — tagStore has
      // no way to know that happened on its own, so it needs to be told.
      await useTagStore.getState().loadAll()

      const createdPart = scanResult.externalTagsCreated > 0 ? `, ${scanResult.externalTagsCreated} new tag(s) created` : ''
      set({ tagImportNote: `Imported ${scanResult.externalTagsApplied} tag(s) from .ts sidecar files${createdPart}` })
      setTimeout(() => {
        if (get().tagImportNote) set({ tagImportNote: null })
      }, 6000)
    }
  } catch (err) {
    set({ scanError: err instanceof Error ? err.message : String(err) })
  } finally {
    unsubscribeProgress?.()
    unsubscribeProgress = null
    set({ isScanning: false, scanProgress: null })
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  libraryRoots: [],
  isLoadingInitial: true,
  isScanning: false,
  scanProgress: null,
  scanError: null,
  loadError: null,
  tagImportNote: null,

  // The very first launch of a freshly-extracted portable build can take a while
  // for these IPC calls to come back (Windows scanning the newly-written
  // executable/native modules before letting them run) — isLoadingInitial exists
  // so the UI can distinguish "still waiting on that" from "genuinely no library
  // yet", which otherwise look identical (both are just an empty tracks array).
  //
  // A failure here (e.g. a corrupted database) used to leave tracks/libraryRoots
  // silently empty with isLoadingInitial cleared — indistinguishable from a
  // genuinely empty library, with no hint anything had gone wrong. loadError
  // surfaces it instead.
  loadInitial: async () => {
    try {
      const [tracks, libraryRoots] = await Promise.all([window.api.listTracks(), window.api.listLibraryRoots()])
      set({ tracks, libraryRoots, loadError: null })
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ isLoadingInitial: false })
    }
  },

  addFolder: async () => {
    const folder = await window.api.pickLibraryFolder()
    if (!folder) return
    await get().rescan(folder)
  },

  rescan: async (rootPath: string) => {
    await runScan(set, get, () => window.api.scanLibrary(rootPath))
  },

  rescanAll: async () => {
    for (const root of get().libraryRoots) {
      await get().rescan(root.path)
    }
  },

  rescanFolder: async (libraryRootId: number, relativePath: string) => {
    await runScan(set, get, () => window.api.scanFolder(libraryRootId, relativePath))
  },

  // Called once a track's real duration is known (from waveform decoding) — patches
  // the in-memory list directly so the track list's duration column fills in live,
  // without waiting for a full rescan/refetch.
  setTrackDuration: (trackId: number, durationSeconds: number) => {
    set({
      tracks: get().tracks.map((t) => (t.id === trackId ? { ...t, durationSeconds } : t))
    })
  },

  setTrackLoudness: (trackId: number, loudnessRms: number) => {
    set({
      tracks: get().tracks.map((t) => (t.id === trackId ? { ...t, loudnessRms } : t))
    })
  },

  setTrackPreviewRange: (trackId: number, start: number | null, end: number | null) => {
    set({
      tracks: get().tracks.map((t) =>
        t.id === trackId ? { ...t, previewStartSeconds: start, previewEndSeconds: end } : t
      )
    })
  },

  // Called after successfully trashing a file — drops it from the in-memory list
  // immediately rather than waiting for the next rescan to notice it's gone.
  removeTracksLocally: (trackIds: number[]) => {
    const idSet = new Set(trackIds)
    set({ tracks: get().tracks.filter((t) => !idSet.has(t.id)) })
  }
}))
