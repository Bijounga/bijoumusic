import { useMemo } from 'react'
import { useTagStore } from '../../state/tagStore'
import { tagColorForId } from '../../lib/tagColors'
import styles from './TrackList.module.css'

// Row height is fixed, so only so many pills can fit before they'd wrap or
// overflow the row — the rest collapse into a "+N" badge instead. The badge's
// title attribute lists the remaining names, so nothing's actually hidden, just
// not spelled out inline.
const MAX_VISIBLE_PILLS = 3

function TrackTagPills({ trackId }: { trackId: number }): React.JSX.Element | null {
  const tagIds = useTagStore((s) => s.trackTags.get(trackId))
  const tags = useTagStore((s) => s.tags)

  const trackTags = useMemo(() => {
    if (!tagIds || tagIds.size === 0) return []
    const byId = new Map(tags.map((t) => [t.id, t]))
    return [...tagIds].map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => t !== undefined)
  }, [tagIds, tags])

  if (trackTags.length === 0) return null

  const visible = trackTags.slice(0, MAX_VISIBLE_PILLS)
  const overflow = trackTags.slice(MAX_VISIBLE_PILLS)

  return (
    <div className={styles.tagPills}>
      {visible.map((tag) => (
        <span
          key={tag.id}
          className={styles.tagPill}
          style={{ '--pill-color': tagColorForId(tag.id) } as React.CSSProperties}
          title={tag.name}
        >
          {tag.name}
        </span>
      ))}
      {overflow.length > 0 && (
        <span className={styles.tagPillMore} title={overflow.map((t) => t.name).join(', ')}>
          +{overflow.length}
        </span>
      )}
    </div>
  )
}

export default TrackTagPills
