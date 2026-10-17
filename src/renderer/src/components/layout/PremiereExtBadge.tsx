import { useEffect } from 'react'
import { startPremiereExtStatusSync, usePremiereExtStore } from '../../state/premiereExtStore'
import styles from './SyncBadge.module.css'

/** Under the sync line: whether the Premiere panels that ship with the app are
 *  installed and current. Click to install them (or repair them); once installed they
 *  update by themselves whenever the app does. */
function PremiereExtBadge(): React.JSX.Element | null {
  const status = usePremiereExtStore((s) => s.status)
  useEffect(() => startPremiereExtStatusSync(), [])

  // Running from source there's nothing packaged to install, and until the first
  // check has run there's nothing to say.
  if (status.state === 'dev' || status.state === 'unknown') return null

  let line: string
  let title: string
  switch (status.state) {
    case 'not-installed':
      line = 'Install Premiere panels…'
      title = 'Installs the BijouMusic panels into Premiere Pro; after that they update with the app'
      break
    case 'updating':
      line = 'Updating Premiere panels…'
      title = 'Installing the Premiere panels'
      break
    case 'restart':
      line = `Restart Premiere to use v${status.version}`
      title = 'The Premiere panels were updated — Premiere loads them when it starts'
      break
    case 'manual':
      line = 'Confirm in Creative Cloud…'
      title = 'Creative Cloud opened to finish installing the panel — click Install there'
      break
    case 'error':
      line = 'Panel update problem — click to retry'
      title = status.message ?? 'The Premiere panels could not be updated'
      break
    default:
      line = `Premiere panels v${status.version} ✓`
      title = 'The Premiere panels are up to date — click to reinstall them'
  }

  const busy = status.state === 'updating'
  const attention = status.state === 'error' || status.state === 'not-installed'

  return (
    <button
      className={`${styles.badge} ${styles.stacked} ${attention ? styles.attention : ''}`}
      onClick={() => {
        if (!busy) void window.api.premiereExtInstall()
      }}
      title={title}
    >
      <svg className={`${styles.icon} ${busy ? styles.busy : ''}`} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 6h16M4 12h16M4 18h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className={styles.line}>{line}</span>
    </button>
  )
}

export default PremiereExtBadge
