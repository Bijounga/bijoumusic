import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Track } from '@shared/types'
import { useSelectionStore } from '../../state/selectionStore'
import TrackRow from './TrackRow'
import TrackContextMenu from './TrackContextMenu'
import styles from './TrackList.module.css'

const ROW_HEIGHT = 52

interface TrackListProps {
  tracks: Track[]
  activeTrackId: number | null
  onSelectTrack: (track: Track) => void
}

interface ContextMenuState {
  tracks: Track[]
  x: number
  y: number
}

function TrackList({ tracks, activeTrackId, onSelectTrack }: TrackListProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const selectOnly = useSelectionStore((s) => s.selectOnly)
  const toggle = useSelectionStore((s) => s.toggle)
  const selectRange = useSelectionStore((s) => s.selectRange)
  const clearSelection = useSelectionStore((s) => s.clear)

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Plain click plays (and selects just that row, replacing any prior selection).
  // Ctrl/Cmd-click toggles one row in/out without touching playback. Shift-click
  // selects the contiguous range from the last click, à la file explorers.
  function handleRowClick(event: React.MouseEvent, track: Track): void {
    if (event.shiftKey) {
      selectRange(
        track.id,
        tracks.map((t) => t.id)
      )
    } else if (event.ctrlKey || event.metaKey) {
      toggle(track.id)
    } else {
      selectOnly(track.id)
      onSelectTrack(track)
    }
  }

  // Right-clicking a row that's already part of the selection acts on the whole
  // selection; right-clicking outside it replaces the selection with just that row
  // first, matching Explorer/Finder.
  function handleContextMenu(track: Track, x: number, y: number): void {
    if (!useSelectionStore.getState().selectedIds.has(track.id)) {
      selectOnly(track.id)
    }
    const finalSelection = useSelectionStore.getState().selectedIds
    const menuTracks = tracks.filter((t) => finalSelection.has(t.id))
    setContextMenu({ tracks: menuTracks.length > 0 ? menuTracks : [track], x, y })
  }

  // Dragging a row that's part of a multi-selection drags every selected file at
  // once (so a drag to Premiere/DaVinci drops the whole batch); otherwise just
  // that one track, regardless of what else happens to be selected.
  function handleDragStart(track: Track): void {
    const selection = useSelectionStore.getState().selectedIds
    const paths =
      selection.has(track.id) && selection.size > 1
        ? tracks.filter((t) => selection.has(t.id)).map((t) => t.currentPath)
        : [track.currentPath]
    window.api.startTrackDrag(paths)
  }

  if (tracks.length === 0) {
    return <div className={styles.emptyState}>No tracks match the current filters</div>
  }

  return (
    <div
      ref={parentRef}
      className={styles.scrollContainer}
      onClick={(e) => {
        if (e.target === e.currentTarget) clearSelection()
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index]
          return (
            <div
              key={track.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <TrackRow
                track={track}
                isActive={track.id === activeTrackId}
                isSelected={selectedIds.has(track.id)}
                onRowClick={handleRowClick}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
              />
            </div>
          )
        })}
      </div>

      {contextMenu && (
        <TrackContextMenu
          tracks={contextMenu.tracks}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

export default TrackList
