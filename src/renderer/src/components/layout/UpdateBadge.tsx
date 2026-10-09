import { useEffect, useState } from 'react'
import logoUrl from '../../assets/logo.png'
import { startUpdateStatusSync, useUpdateStore } from '../../state/updateStore'
import styles from './UpdateBadge.module.css'

// How long the "up to date" / error line stays before the badge goes quiet again.
const NOTICE_MS = 4000

/** The BijouMusic logo at the top of the sidebar. Click it to check for updates;
 *  while a new version downloads it shows progress, and once it's ready the same
 *  click restarts the app into it. Checks also happen on their own at launch. */
function UpdateBadge(): React.JSX.Element {
  const status = useUpdateStore((s) => s.status)
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => startUpdateStatusSync(), [])

  // "Up to date" and errors are momentary; downloads and "ready" stay put.
  useEffect(() => {
    if (status.state !== 'not-available' && status.state !== 'error' && status.state !== 'dev') {
      setShowNotice(false)
      return
    }
    setShowNotice(true)
    const timer = setTimeout(() => setShowNotice(false), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [status])

  const version = status.currentVersion ? `v${status.currentVersion}` : ''
  const busy = status.state === 'checking' || status.state === 'downloading'
  const ready = status.state === 'downloaded'

  let line: string | null = null
  if (status.state === 'checking') line = 'Checking for updates…'
  else if (status.state === 'downloading') line = `Downloading v${status.version ?? ''}${status.percent ? ` · ${status.percent}%` : '…'}`
  else if (ready) line = `v${status.version} ready — click to restart`
  else if (status.state === 'available-manual') line = `v${status.version} available — click to get it`
  else if (showNotice && status.state === 'not-available') line = `You're up to date ✓`
  else if (showNotice && status.state === 'error') line = `Couldn't check — click to retry`
  else if (showNotice && status.state === 'dev') line = 'Updates work in the installed app'

  function handleClick(): void {
    if (busy) return
    if (ready) void window.api.updateInstallNow()
    else if (status.state === 'available-manual') window.api.updateOpenReleases()
    else void window.api.updateCheckNow()
  }

  return (
    <button
      className={`${styles.badge} ${ready ? styles.ready : ''}`}
      onClick={handleClick}
      title={
        ready
          ? 'Restart BijouMusic to finish updating'
          : `BijouMusic ${version} — click to check for updates`.replace('  ', ' ')
      }
      aria-label="Check for updates"
    >
      <img className={`${styles.logo} ${busy ? styles.logoBusy : ''}`} src={logoUrl} alt="" draggable={false} />
      <span className={styles.text}>
        <span className={styles.name}>BijouMusic</span>
        <span className={`${styles.line} ${line ? styles.lineVisible : ''}`}>{line ?? version}</span>
      </span>
      {ready && <span className={styles.dot} />}
    </button>
  )
}

export default UpdateBadge
