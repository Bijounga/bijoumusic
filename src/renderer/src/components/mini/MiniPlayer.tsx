import { useEffect, useState } from 'react'
import type { MiniPlayerState } from '@shared/types'
import { useAlbumArt } from '../../audio/useAlbumArt'
import { formatDuration } from '../../lib/format'
import { NextTrackIcon, PauseIcon, PlayIcon, PreviousTrackIcon } from '../player/TransportIcons'
import VolumeSlider from '../player/VolumeSlider'
import styles from './MiniPlayer.module.css'

/** The pop-out mini player window. Owns no playback — it shows the state the main
 *  window streams to it and sends button presses back (see useMiniPlayerBridge).
 *  Deliberately imports nothing that touches the audio engine or the library
 *  stores, so this window never starts a second player. */
function MiniPlayer(): React.JSX.Element {
  const [state, setState] = useState<MiniPlayerState>({
    track: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    theme: '',
    volume: 0.8
  })
  const art = useAlbumArt(state.track)

  useEffect(() => {
    void window.api.miniGetState().then(setState)
    return window.api.onMiniState(setState)
  }, [])

  // Match the main window's theme, which it sends along with playback state.
  useEffect(() => {
    if (state.theme) document.documentElement.dataset.theme = state.theme
  }, [state.theme])

  const fraction = state.duration > 0 ? Math.min(1, state.currentTime / state.duration) : 0
  const send = window.api.miniSendCommand

  return (
    <div className={styles.player}>
      <div className={styles.art}>{art ? <img src={art} alt="" draggable={false} /> : <span>♪</span>}</div>

      <div className={styles.info}>
        <div className={styles.title} title={state.track?.filename}>
          {state.track ? state.track.filename : 'Nothing playing'}
        </div>
        <div className={styles.sub}>{state.track?.folderPath || ' '}</div>
        <div className={styles.time}>
          {formatDuration(state.currentTime)} / {formatDuration(state.duration)}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.transport}>
          <button className={styles.bubble} title="Previous" disabled={!state.track} onClick={() => send({ type: 'previous' })}>
            <PreviousTrackIcon size={14} />
          </button>
          <button
            className={styles.orb}
            title={state.isPlaying ? 'Pause' : 'Play'}
            disabled={!state.track}
            onClick={() => send({ type: 'toggle' })}
          >
            {state.isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <button className={styles.bubble} title="Next" disabled={!state.track} onClick={() => send({ type: 'next' })}>
            <NextTrackIcon size={14} />
          </button>
        </div>
        <div className={styles.volume}>
          <VolumeSlider
            volume={state.volume}
            width={92}
            onChange={(value) => {
              // Move the slider immediately; the main window confirms in its next update.
              setState((s) => ({ ...s, volume: value }))
              send({ type: 'volume', value })
            }}
          />
        </div>
      </div>

      <div className={styles.windowButtons}>
        <button className={styles.windowButton} title="Open BijouMusic" onClick={() => window.api.miniShowMain()}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M4 1H1v8h8V6M6 1h3v3M9 1L4.5 5.5" />
          </svg>
        </button>
        <button className={`${styles.windowButton} ${styles.closeButton}`} title="Close mini player" onClick={() => window.api.miniClose()}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>

      <div
        className={styles.progress}
        title="Click to seek"
        onClick={(event) => {
          if (!state.track) return
          const rect = event.currentTarget.getBoundingClientRect()
          send({ type: 'seek', fraction: (event.clientX - rect.left) / rect.width })
        }}
      >
        <div className={styles.progressFill} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  )
}

export default MiniPlayer
