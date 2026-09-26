import { useEffect, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../../state/playbackStore'
import { useBookmarkStore } from '../../state/bookmarkStore'
import { formatDuration } from '../../lib/format'
import styles from './BookmarksPopover.module.css'

function BookmarksPopover({ track }: { track: Track | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const currentTime = usePlaybackStore((s) => s.currentTime)
  const seek = usePlaybackStore((s) => s.seek)
  const bookmarksByTrack = useBookmarkStore((s) => s.bookmarksByTrack)
  const addBookmark = useBookmarkStore((s) => s.addBookmark)
  const deleteBookmark = useBookmarkStore((s) => s.deleteBookmark)

  const bookmarks = track ? (bookmarksByTrack.get(track.id) ?? []) : []

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  async function submitBookmark(): Promise<void> {
    if (!track) return
    await addBookmark(track.id, currentTime, newLabel.trim() || null)
    setNewLabel('')
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${bookmarks.length > 0 ? styles.triggerActive : ''}`}
        disabled={!track}
        onClick={() => setOpen((v) => !v)}
      >
        {bookmarks.length > 0 ? `Bookmarks (${bookmarks.length})` : 'Bookmarks'}
      </button>

      {open && track && (
        <div className={styles.popover}>
          {bookmarks.length === 0 && <p className={styles.emptyHint}>No bookmarks yet on this track</p>}
          {bookmarks.map((bookmark) => (
            <div key={bookmark.id} className={styles.bookmarkRow} onClick={() => seek(bookmark.positionSeconds)}>
              <span className={styles.bookmarkTime}>{formatDuration(bookmark.positionSeconds)}</span>
              <span className={styles.bookmarkLabel}>{bookmark.label ?? ''}</span>
              <span
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteBookmark(bookmark.id, track.id)
                }}
              >
                ×
              </span>
            </div>
          ))}
          <div className={styles.addRow}>
            <button
              className={styles.addAtCurrentBtn}
              onClick={() => void submitBookmark()}
              title={`Drop a bookmark at ${formatDuration(currentTime)}`}
            >
              + at {formatDuration(currentTime)}
            </button>
            <input
              className={styles.labelInput}
              placeholder="label…"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitBookmark()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default BookmarksPopover
