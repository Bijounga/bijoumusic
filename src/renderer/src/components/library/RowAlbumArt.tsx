import type { Track } from '@shared/types'
import { useAlbumArt } from '../../audio/useAlbumArt'
import styles from './TrackList.module.css'

function RowAlbumArt({ track }: { track: Track }): React.JSX.Element {
  const art = useAlbumArt(track)

  if (!art) {
    return (
      <div className={styles.rowArtPlaceholder} title="No embedded art">
        ♫
      </div>
    )
  }

  return <img className={styles.rowArt} src={art} alt="" />
}

export default RowAlbumArt
