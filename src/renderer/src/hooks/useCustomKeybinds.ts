import { useEffect } from 'react'
import type { Track } from '@shared/types'
import { useKeybindStore } from '../state/keybindStore'
import { useFilterStore } from '../state/filterStore'
import { useUiSignalStore } from '../state/uiSignalStore'
import { usePlaybackStore } from '../state/playbackStore'
import { useLibraryStore } from '../state/libraryStore'
import { useTagStore } from '../state/tagStore'
import { usePreviewClipStore } from '../state/previewClipStore'
import { useShuffleStore } from '../state/shuffleStore'
import { useAutoplayStore } from '../state/autoplayStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/** Fires whichever user-configured action is bound to the pressed key. Separate
 *  from useKeyboardShortcuts since these bindings are user-editable at runtime
 *  (via the Keybinds section), not fixed. */
export function useCustomKeybinds(visibleTracks: Track[]): void {
  const binds = useKeybindStore((s) => s.binds)
  const isCapturingKeybind = useKeybindStore((s) => s.isCapturingKeybind)
  const clearTags = useFilterStore((s) => s.clearTags)
  const clearAllFilters = useFilterStore((s) => s.clearAllFilters)
  const setSelectedFolder = useFilterStore((s) => s.setSelectedFolder)
  const requestOpenAliasEditor = useUiSignalStore((s) => s.requestOpenAliasEditor)
  const requestOpenDownloadModal = useUiSignalStore((s) => s.requestOpenDownloadModal)

  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const playTrack = usePlaybackStore((s) => s.playTrack)

  const libraryTracks = useLibraryStore((s) => s.tracks)
  const setTrackPreviewRange = useLibraryStore((s) => s.setTrackPreviewRange)

  const trackTags = useTagStore((s) => s.trackTags)
  const addTrackTag = useTagStore((s) => s.addTrackTag)
  const removeTrackTag = useTagStore((s) => s.removeTrackTag)

  const toggleDrawingRange = usePreviewClipStore((s) => s.toggleDrawingRange)
  const toggleShuffleMode = useShuffleStore((s) => s.toggle)
  const toggleAutoplay = useAutoplayStore((s) => s.toggle)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isCapturingKeybind) return
      if (isTypingTarget(event.target)) return
      const bind = binds.find((b) => b.key === event.code)
      if (!bind) return
      event.preventDefault()

      if (bind.action === 'clearTags') {
        clearTags()
      } else if (bind.action === 'clearAllFilters') {
        clearAllFilters()
      } else if (bind.action === 'jumpToFolder' && bind.folderLibraryRootId !== undefined) {
        setSelectedFolder({
          libraryRootId: bind.folderLibraryRootId,
          relativePath: bind.folderRelativePath ?? ''
        })
      } else if (bind.action === 'focusAliasInput') {
        requestOpenAliasEditor()
      } else if (bind.action === 'applyTag' && bind.tagId !== undefined) {
        if (currentTrack) void addTrackTag(currentTrack.id, bind.tagId)
      } else if (bind.action === 'clearTrackTags') {
        if (currentTrack) {
          for (const tagId of trackTags.get(currentTrack.id) ?? []) void removeTrackTag(currentTrack.id, tagId)
        }
      } else if (bind.action === 'shuffle') {
        if (visibleTracks.length > 0) playTrack(visibleTracks[Math.floor(Math.random() * visibleTracks.length)])
      } else if (bind.action === 'toggleShuffleMode') {
        toggleShuffleMode()
      } else if (bind.action === 'toggleAutoplay') {
        toggleAutoplay()
      } else if (bind.action === 'openDownloadModal') {
        requestOpenDownloadModal()
      } else if (bind.action === 'toggleDrawRange') {
        toggleDrawingRange()
      } else if (bind.action === 'setPreviewStart' || bind.action === 'setPreviewEnd') {
        if (!currentTrack) return
        // currentTrack is a snapshot from when playback started, not live-patched —
        // read the up-to-date preview range straight from libraryStore instead.
        const liveTrack = libraryTracks.find((t) => t.id === currentTrack.id)
        const start = liveTrack?.previewStartSeconds ?? null
        const end = liveTrack?.previewEndSeconds ?? null
        if (bind.action === 'setPreviewStart') {
          const nextEnd = end !== null && end > currentTime ? end : null
          void window.api.updateTrackPreviewRange(currentTrack.id, currentTime, nextEnd)
          setTrackPreviewRange(currentTrack.id, currentTime, nextEnd)
        } else {
          const nextStart = start !== null && start < currentTime ? start : 0
          void window.api.updateTrackPreviewRange(currentTrack.id, nextStart, currentTime)
          setTrackPreviewRange(currentTrack.id, nextStart, currentTime)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    binds,
    clearTags,
    clearAllFilters,
    setSelectedFolder,
    requestOpenAliasEditor,
    requestOpenDownloadModal,
    isCapturingKeybind,
    currentTrack,
    currentTime,
    playTrack,
    visibleTracks,
    libraryTracks,
    setTrackPreviewRange,
    trackTags,
    addTrackTag,
    removeTrackTag,
    toggleDrawingRange,
    toggleShuffleMode,
    toggleAutoplay
  ])
}
