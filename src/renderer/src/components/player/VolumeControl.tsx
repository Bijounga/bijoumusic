import { usePlaybackStore } from '../../state/playbackStore'
import VolumeSlider from './VolumeSlider'
import styles from './VolumeControl.module.css'

function VolumeControl(): React.JSX.Element {
  const volume = usePlaybackStore((s) => s.volume)
  const setVolume = usePlaybackStore((s) => s.setVolume)
  const normalizationEnabled = usePlaybackStore((s) => s.normalizationEnabled)
  const setNormalizationEnabled = usePlaybackStore((s) => s.setNormalizationEnabled)

  return (
    <div className={styles.wrapper}>
      <VolumeSlider volume={volume} onChange={setVolume} />
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
