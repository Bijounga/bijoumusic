import { useEffect, useState } from 'react'
import { startSyncStatusSync, useSyncStore } from '../../state/syncStore'
import styles from './SyncBadge.module.css'

function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/** Under the logo: whether tags, ratings and so on are being kept in step with the
 *  other computer through the cloud folder. Click to set it up, or to sync right now. */
function SyncBadge(): React.JSX.Element {
  const status = useSyncStore((s) => s.status)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => startSyncStatusSync(), [])
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  let line: string
  let title: string
  if (status.state === 'off') {
    line = 'Set up tag sync…'
    title = 'Keep tags, ratings, aliases and projects the same on all your computers'
  } else if (status.state === 'syncing') {
    line = 'Syncing…'
    title = 'Syncing with your other computers'
  } else if (status.state === 'unavailable') {
    line = 'Sync folder not found'
    title = status.message ?? 'Is Google Drive connected?'
  } else if (status.state === 'error') {
    line = 'Sync problem — click to retry'
    title = status.message ?? 'Sync failed'
  } else {
    const when = status.lastSyncAt ? ago(status.lastSyncAt, now) : ''
    const extra = status.changed ? ` · ${status.changed} updated` : ''
    line = `Synced ${when}${extra}`.trim()
    title = `Tags are synced through ${status.folder ?? 'the sync folder'} — click to sync now`
  }

  const busy = status.state === 'syncing'
  const attention = status.state === 'error' || status.state === 'unavailable'

  function handleClick(): void {
    if (busy) return
    void (status.state === 'off' ? window.api.syncSetup() : window.api.syncNow())
  }

  return (
    <button className={`${styles.badge} ${attention ? styles.attention : ''}`} onClick={handleClick} title={title}>
      <svg className={`${styles.icon} ${busy ? styles.busy : ''}`} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M17.5 19a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.4 8.6 5 5 0 0 0 7 19h10.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.line}>{line}</span>
    </button>
  )
}

export default SyncBadge
