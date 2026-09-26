import { useEffect, useRef, useState } from 'react'
import type { TagStorageInfo } from '@shared/types'
import styles from './TagStorageInfoPopover.module.css'

interface TagStorageInfoPopoverProps {
  x: number
  y: number
  tagId: number
  tagName: string
  /** What the sidebar is showing right now for this tag, so a mismatch against
   *  the freshly-queried count is obvious without doing the subtraction. */
  shownCount: number
  onClose: () => void
}

/** Shows exactly where a tag's data actually lives on disk, and — since this
 *  queries the file with a brand-new connection rather than the app's own
 *  long-lived one — doubles as a live check for the stale-connection bug: if
 *  "right now, on disk" ever disagrees with what the sidebar is showing, this
 *  is where that becomes visible without needing an external tool to catch it. */
function TagStorageInfoPopover({ x, y, tagId, tagName, shownCount, onClose }: TagStorageInfoPopoverProps): React.JSX.Element {
  const [info, setInfo] = useState<TagStorageInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getTagStorageInfo(tagId)
      .then((result) => {
        if (!cancelled) setInfo(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [tagId])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) onClose()
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const matches = info !== null && info.cachedCount === info.freshCount && info.freshCount === shownCount

  return (
    <div className={styles.popover} ref={popoverRef} style={{ left: x, top: y }}>
      <p className={styles.title}>{tagName}</p>
      {error && <p className={styles.error}>Couldn't check: {error}</p>}
      {!error && !info && <p className={styles.hint}>Checking…</p>}
      {info && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>Stored at</span>
            <span className={styles.pathValue} title={info.dbPath}>
              {info.dbPath}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Showing in sidebar</span>
            <span>{shownCount}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Right now, on disk</span>
            <span>{info.freshCount}</span>
          </div>
          <p className={matches ? styles.ok : styles.mismatch}>
            {matches
              ? '✓ Matches — this tag is showing up to date.'
              : "⚠ Doesn't match what's on disk — the app's data connection has gone stale. Click into a different window and back to force a refresh."}
          </p>
        </>
      )}
    </div>
  )
}

export default TagStorageInfoPopover
