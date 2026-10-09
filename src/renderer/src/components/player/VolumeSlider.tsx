import { useRef } from 'react'
import { BOOST_START_PERCENT, sliderPercentToVolume, volumeToSliderPercent } from '../../lib/volume'
import styles from './VolumeControl.module.css'

interface VolumeSliderProps {
  volume: number
  onChange: (volume: number) => void
  /** Slider width in px (the mini player uses a shorter one). */
  width?: number
}

/** Mute button + volume slider, without any state of its own — the main player
 *  feeds it the playback store, the pop-out mini player feeds it the state the
 *  main window streams over. Imports nothing audio-related, so it's safe in the
 *  mini player's window. */
function VolumeSlider({ volume, onChange, width }: VolumeSliderProps): React.JSX.Element {
  const lastNonZeroVolume = useRef(volume || 0.8)
  if (volume > 0) lastNonZeroVolume.current = volume

  const isBoosted = volume > 1
  const sliderPercent = volumeToSliderPercent(volume)

  // Filled portion is the accent up to the 100% mark, then the boost color beyond
  // it — so the boost zone is visible on the track even before you drag into it.
  const trackGradient =
    sliderPercent <= BOOST_START_PERCENT
      ? `linear-gradient(to right, var(--accent) 0%, var(--accent) ${sliderPercent}%, var(--surface-3) ${sliderPercent}%, var(--surface-3) 100%)`
      : `linear-gradient(to right, var(--accent) 0%, var(--accent) ${BOOST_START_PERCENT}%, var(--volume-boost) ${BOOST_START_PERCENT}%, var(--volume-boost) ${sliderPercent}%, var(--surface-3) ${sliderPercent}%, var(--surface-3) 100%)`

  return (
    <>
      <button
        className={styles.muteButton}
        onClick={() => onChange(volume > 0 ? 0 : lastNonZeroVolume.current)}
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        title={volume === 0 ? 'Unmute' : 'Mute'}
      >
        {volume === 0 ? '✕' : '♫'}
      </button>
      <input
        className={`${styles.slider} ${isBoosted ? styles.sliderBoosted : ''}`}
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={sliderPercent}
        style={{ background: trackGradient, ...(width ? { width } : {}) }}
        onChange={(e) => onChange(sliderPercentToVolume(Number(e.target.value)))}
        aria-label="Volume"
        title={`${Math.round(volume * 100)}%`}
      />
    </>
  )
}

export default VolumeSlider
