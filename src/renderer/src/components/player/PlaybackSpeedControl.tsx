import { useEffect, useRef, useState } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import styles from './PlaybackSpeedControl.module.css'

const PRESET_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function formatSpeed(rate: number): string {
  const rounded = Math.round(rate * 100) / 100
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}x`
}

function PlaybackSpeedControl(): React.JSX.Element {
  const playbackRate = usePlaybackStore((s) => s.playbackRate)
  const setPlaybackRate = usePlaybackStore((s) => s.setPlaybackRate)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${playbackRate !== 1 ? styles.triggerActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Playback speed"
      >
        {formatSpeed(playbackRate)}
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.presetRow}>
            {PRESET_SPEEDS.map((speed) => (
              <button
                key={speed}
                className={`${styles.presetBtn} ${playbackRate === speed ? styles.presetBtnActive : ''}`}
                onClick={() => setPlaybackRate(speed)}
              >
                {formatSpeed(speed)}
              </button>
            ))}
          </div>
          <input
            className={styles.slider}
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={playbackRate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
            aria-label="Playback speed"
          />
        </div>
      )}
    </div>
  )
}

export default PlaybackSpeedControl
