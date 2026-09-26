import { memo } from 'react'
import type { Track } from '@shared/types'
import { formatDuration } from '../../lib/format'
import { useRatingStore } from '../../state/ratingStore'
import { FAVORITE_LEVELS } from '../../lib/ratings'
import ScrollingText from '../common/ScrollingText'
import RowAlbumArt from './RowAlbumArt'
import RowWaveform from './RowWaveform'
import TrackTagPills from './TrackTagPills'
import styles from './TrackList.module.css'

interface TrackRowProps {
  track: Track
  isActive: boolean
  isSelected: boolean
  onRowClick: (event: React.MouseEvent, track: Track) => void
  onContextMenu: (track: Track, x: number, y: number) => void
  onDragStart: (track: Track) => void
}

function TrackRow({
  track,
  isActive,
  isSelected,
  onRowClick,
  onContextMenu,
  onDragStart
}: TrackRowProps): React.JSX.Element {
  const favoriteLevel = useRatingStore((s) => s.ratings.get(track.id)?.favoriteLevel ?? null)
  const favoriteMeta = favoriteLevel !== null ? FAVORITE_LEVELS.find((f) => f.level === favoriteLevel) : null
  const hasEnergy = useRatingStore((s) => s.ratings.get(track.id)?.energyLevel != null)

  return (
    <div
      className={`${styles.row} ${isActive ? styles.rowActive : ''} ${isSelected ? styles.rowSelected : ''}`}
      onClick={(e) => onRowClick(e, track)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(track, e.clientX, e.clientY)
      }}
      draggable
      onDragStart={(e) => {
        e.preventDefault()
        onDragStart(track)
      }}
    >
      <RowAlbumArt track={track} />
      <div className={styles.info}>
        <div className={styles.nameRow}>
          {favoriteMeta && (
            <span
              className={styles.favoriteDot}
              style={{ color: `var(${favoriteMeta.cssVar})` }}
              title={favoriteMeta.label}
            >
              {favoriteMeta.glyph}
            </span>
          )}
          {hasEnergy && (
            <span className={styles.energyDot} title="Has an energy level">
              ▲
            </span>
          )}
          <ScrollingText text={track.filename} scroll={isActive} className={styles.filename} />
        </div>
        <span className={styles.folder}>{track.folderPath || '(root)'}</span>
      </div>
      <TrackTagPills trackId={track.id} />
      <RowWaveform track={track} />
      <span className={styles.duration}>{formatDuration(track.durationSeconds)}</span>
    </div>
  )
}

export default memo(
  TrackRow,
  (prev, next) => prev.track === next.track && prev.isActive === next.isActive && prev.isSelected === next.isSelected
)
