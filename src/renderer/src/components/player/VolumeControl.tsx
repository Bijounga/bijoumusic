import { useRef } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import { MAX_VOLUME } from '../../audio/AudioEngine'
import styles from './VolumeControl.module.css'

// The 0-100% range gets most of the bar; boosting past 100% (up to MAX_VOLUME) is
// squeezed into the remaining stretch so the bar reads "mostly normal range, a
// little extra headroom" instead of half the bar being boost you rarely need.
const BOOST_START_PERCENT = 75

function volumeToSliderPercent(volume: number): number {
  if (volume <= 1) return volume * BOOST_START_PERCENT
  const boostFraction = (volume - 1) / (MAX_VOLUME - 1)
  return BOOST_START_PERCENT + boostFraction * (100 - BOOST_START_PERCENT)
}

function sliderPercentToVolume(percent: number): number {
  if (percent <= BOOST_START_PERCENT) return (percent / BOOST_START_PERCENT) * 1
  const boostFraction = (percent - BOOST_START_PERCENT) / (100 - BOOST_START_PERCENT)
  return 1 + boostFraction * (MAX_VOLUME - 1)
}

function volumeGlyph(volume: number): string {
  return volume === 0 ? '✕' : '♫'
}

function VolumeControl(): React.JSX.Element {
  const volume = usePlaybackStore((s) => s.volume)
  const setVolume = usePlaybackStore((s) => s.setVolume)
  const normalizationEnabled = usePlaybackStore((s) => s.normalizationEnabled)
  const setNormalizationEnabled = usePlaybackStore((s) => s.setNormalizationEnabled)
  const lastNonZeroVolume = useRef(volume || 0.8)

  function toggleMute(): void {
    if (volume > 0) {
      lastNonZeroVolume.current = volume
      setVolume(0)
    } else {
      setVolume(lastNonZeroVolume.current)
    }
  }

  const isBoosted = volume > 1
  const sliderPercent = volumeToSliderPercent(volume)

  // Filled portion is blue up to the 100% mark, then switches to the boost color
  // beyond it — so the boost zone is visible on the track even before you drag into it.
  const trackGradient =
    sliderPercent <= BOOST_START_PERCENT
      ? `linear-gradient(to right, var(--accent) 0%, var(--accent) ${sliderPercent}%, var(--surface-3) ${sliderPercent}%, var(--surface-3) 100%)`
      : `linear-gradient(to right, var(--accent) 0%, var(--accent) ${BOOST_START_PERCENT}%, var(--volume-boost) ${BOOST_START_PERCENT}%, var(--volume-boost) ${sliderPercent}%, var(--surface-3) ${sliderPercent}%, var(--surface-3) 100%)`

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.muteButton}
        onClick={toggleMute}
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        title={volume === 0 ? 'Unmute' : 'Mute'}
      >
        {volumeGlyph(volume)}
      </button>
      <input
        className={`${styles.slider} ${isBoosted ? styles.sliderBoosted : ''}`}
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={sliderPercent}
        style={{ background: trackGradient }}
        onChange={(e) => {
          const next = sliderPercentToVolume(Number(e.target.value))
          if (next > 0) lastNonZeroVolume.current = next
          setVolume(next)
        }}
        aria-label="Volume"
        title={`${Math.round(volume * 100)}%`}
      />
      <button
        className={`${styles.normalizeBtn} ${normalizationEnabled ? styles.normalizeBtnActive : ''}`}
        onClick={() => setNormalizationEnabled(!normalizationEnabled)}
        aria-label={normalizationEnabled ? 'Disable volume normalization' : 'Enable volume normalization'}
        title={
          normalizationEnabled
            ? 'Volume normalization on — quiet/loud tracks are evened out'
            : 'Volume normalization off'
        }
      >
        N
      </button>
    </div>
  )
}

export default VolumeControl
