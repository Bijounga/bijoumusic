import { useMemo } from 'react'
import { useRatingStore } from '../../state/ratingStore'
import { useFilterStore } from '../../state/filterStore'
import { ENERGY_LEVELS } from '../../lib/ratings'
import styles from './RatingSidebarSections.module.css'

function EnergySidebarSection(): React.JSX.Element {
  const ratings = useRatingStore((s) => s.ratings)
  const selectedEnergyLevel = useFilterStore((s) => s.selectedEnergyLevel)
  const toggleEnergyLevel = useFilterStore((s) => s.toggleEnergyLevel)

  const counts = useMemo(() => {
    const map = new Map<number, number>()
    for (const rating of ratings.values()) {
      if (rating.energyLevel === null) continue
      map.set(rating.energyLevel, (map.get(rating.energyLevel) ?? 0) + 1)
    }
    return map
  }, [ratings])

  return (
    <div>
      {ENERGY_LEVELS.map((level) => {
        const isActive = selectedEnergyLevel === level
        return (
          <div
            key={level}
            className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
            onClick={() => toggleEnergyLevel(level)}
          >
            <span className={styles.glyph}>{level}</span>
            <span className={styles.label}>Energy {level}</span>
            <span className={styles.count}>{counts.get(level) ?? 0}</span>
          </div>
        )
      })}
    </div>
  )
}

export default EnergySidebarSection
