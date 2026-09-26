import type { Track } from '@shared/types'
import { useAlbumArt } from '../../audio/useAlbumArt'
import styles from './AlbumArt.module.css'

function AlbumArt({ track }: { track: Track | null }): React.JSX.Element {
  const art = useAlbumArt(track)

  if (!track) {
    return <div className={styles.placeholder} />
  }

  if (!art) {
    return (
      <div className={styles.placeholder} title="No embedded art">
        ♫
      </div>
    )
  }

  return <img className={styles.art} src={art} alt="" />
}

export default AlbumArt
