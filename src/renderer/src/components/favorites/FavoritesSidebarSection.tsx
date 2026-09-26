import { useMemo } from 'react'
import { useRatingStore } from '../../state/ratingStore'
import { useFilterStore } from '../../state/filterStore'
import { FAVORITE_LEVELS } from '../../lib/ratings'
import styles from './RatingSidebarSections.module.css'

function FavoritesSidebarSection(): React.JSX.Element {
  const ratings = useRatingStore((s) => s.ratings)
  const selectedFavoriteLevel = useFilterStore((s) => s.selectedFavoriteLevel)
  const toggleFavoriteLevel = useFilterStore((s) => s.toggleFavoriteLevel)

  const counts = useMemo(() => {
    const map = new Map<number, number>()
    for (const rating of ratings.values()) {
      if (rating.favoriteLevel === null) continue
      map.set(rating.favoriteLevel, (map.get(rating.favoriteLevel) ?? 0) + 1)
    }
    return map
  }, [ratings])

  return (
    <div>
      {FAVORITE_LEVELS.map(({ level, label, cssVar, glyph }) => {
        const isActive = selectedFavoriteLevel === level
        return (
          <div
            key={level}
            className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
            onClick={() => toggleFavoriteLevel(level)}
          >
            <span className={styles.glyph} style={{ color: `var(${cssVar})` }}>
              {glyph}
            </span>
            <span className={styles.label}>{label}</span>
            <span className={styles.count}>{counts.get(level) ?? 0}</span>
          </div>
        )
      })}
    </div>
  )
}

export default FavoritesSidebarSection
