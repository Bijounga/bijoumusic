import { useEffect, useState } from 'react'
import iconUrl from '../../assets/titlebar-icon.png'
import styles from './TitleBar.module.css'

function TitleBar(): React.JSX.Element {
  const isMac = window.api.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)
  const [miniOpen, setMiniOpen] = useState(false)

  useEffect(() => {
    window.api.windowIsMaximized().then(setMaximized)
    return window.api.onWindowMaximizedChanged(setMaximized)
  }, [])

  useEffect(() => window.api.onMiniOpenChanged(setMiniOpen), [])

  return (
    <div className={`${styles.bar} ${isMac ? styles.mac : ''}`}>
      <img className={styles.icon} src={iconUrl} alt="" draggable={false} />
      <span className={styles.title}>BijouMusic</span>
      <div className={styles.captions}>
        <button
          className={styles.caption}
          tabIndex={-1}
          title={miniOpen ? 'Close mini player' : 'Pop out mini player'}
          onClick={() => window.api.miniToggle()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9z" />
            <path d="M5 5h3.5v3h-3.5z" fill="currentColor" stroke="none" />
          </svg>
        </button>
        {!isMac && (
          <>
          <button className={styles.caption} tabIndex={-1} title="Minimize" onClick={() => window.api.windowMinimize()}>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5.5h10" />
            </svg>
          </button>
          <button
            className={styles.caption}
            tabIndex={-1}
            title={maximized ? 'Restore Down' : 'Maximize'}
            onClick={() => window.api.windowToggleMaximize()}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              {maximized ? <path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" /> : <path d="M0.5 0.5h9v9h-9z" />}
            </svg>
          </button>
          <button
            className={`${styles.caption} ${styles.close}`}
            tabIndex={-1}
            title="Close"
            onClick={() => window.api.windowClose()}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
            </svg>
          </button>
          </>
        )}
      </div>
    </div>
  )
}

export default TitleBar
