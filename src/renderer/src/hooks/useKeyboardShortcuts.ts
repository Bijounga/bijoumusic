import { useEffect } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../state/playbackStore'
import { useFilterStore } from '../state/filterStore'
import { useKeybindStore } from '../state/keybindStore'
import { useSelectionStore } from '../state/selectionStore'

const SEEK_STEP_SECONDS = 5

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/** Space = play/pause. Up/Down = step through `visibleTracks` — the same ordered
 *  list TrackList renders, so keyboard navigation and what's on screen never disagree.
 *  Left/Right = seek 5s back/forward within the current track. Backspace = jump back
 *  to the full library (clears folder/view, however deep you are). */
export function useKeyboardShortcuts(visibleTracks: Track[]): void {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const playTrack = usePlaybackStore((s) => s.playTrack)
  const seekBy = usePlaybackStore((s) => s.seekBy)
  const setSelectedFolder = useFilterStore((s) => s.setSelectedFolder)
  const isCapturingKeybind = useKeybindStore((s) => s.isCapturingKeybind)
  const clearSelection = useSelectionStore((s) => s.clear)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isCapturingKeybind) return
      if (isTypingTarget(event.target)) return

      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayPause()
        return
      }

      if (event.code === 'Escape') {
        clearSelection()
        return
      }

      if (event.code === 'Backspace') {
        event.preventDefault()
        setSelectedFolder(null)
        return
      }

      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!currentTrack) return
        event.preventDefault()
        seekBy(event.code === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS)
        return
      }

      if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return
      if (visibleTracks.length === 0) return
      event.preventDefault()

      const currentIndex = currentTrack ? visibleTracks.findIndex((t) => t.id === currentTrack.id) : -1
      let nextIndex: number
      if (currentIndex === -1) {
        nextIndex = 0
      } else if (event.code === 'ArrowUp') {
        nextIndex = Math.max(0, currentIndex - 1)
      } else {
        nextIndex = Math.min(visibleTracks.length - 1, currentIndex + 1)
      }
      void playTrack(visibleTracks[nextIndex])
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visibleTracks, currentTrack, togglePlayPause, playTrack, seekBy, setSelectedFolder, clearSelection, isCapturingKeybind])
}
