import type { Track } from '@shared/types'
import { useRatingStore } from '../../state/ratingStore'
import { ENERGY_LEVELS } from '../../lib/ratings'
import styles from './EnergySelector.module.css'

function EnergySelector({ track }: { track: Track | null }): React.JSX.Element {
  const ratings = useRatingStore((s) => s.ratings)
  const setEnergyLevel = useRatingStore((s) => s.setEnergyLevel)

  const currentLevel = track ? (ratings.get(track.id)?.energyLevel ?? null) : null

  return (
    <div className={styles.row}>
      {ENERGY_LEVELS.map((level) => {
        const isActive = currentLevel === level
        return (
          <button
            key={level}
            className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
            disabled={!track}
            title={`Energy ${level}`}
            aria-label={`Energy ${level}`}
            onClick={() => track && void setEnergyLevel(track.id, isActive ? null : level)}
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}

export default EnergySelector
