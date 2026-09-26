import type { Track } from '@shared/types'
import { useRatingStore } from '../../state/ratingStore'
import { FAVORITE_LEVELS } from '../../lib/ratings'
import styles from './FavoriteSelector.module.css'

function FavoriteSelector({ track }: { track: Track | null }): React.JSX.Element {
  const ratings = useRatingStore((s) => s.ratings)
  const setFavoriteLevel = useRatingStore((s) => s.setFavoriteLevel)

  const currentLevel = track ? (ratings.get(track.id)?.favoriteLevel ?? null) : null

  return (
    <div className={styles.row}>
      {FAVORITE_LEVELS.map(({ level, label, cssVar, glyph }) => {
        const isActive = currentLevel === level
        return (
          <button
            key={level}
            className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
            style={{ color: isActive ? `var(${cssVar})` : undefined }}
            disabled={!track}
            title={label}
            aria-label={label}
            onClick={() => track && void setFavoriteLevel(track.id, isActive ? null : level)}
          >
            {glyph}
          </button>
        )
      })}
    </div>
  )
}

export default FavoriteSelector
