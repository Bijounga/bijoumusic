import { useEffect, useRef, useState } from 'react'
import styles from './ZoomToast.module.css'

const VISIBLE_MS = 1400

/** Briefly shows the new zoom level after Ctrl +/−/0 or Ctrl + wheel, so it's
 *  clear the change happened and that it applies to this monitor. */
function ZoomToast(): React.JSX.Element | null {
  const [zoom, setZoom] = useState<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const unsubscribe = window.api.onWindowZoomChanged((next) => {
      setZoom(next)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setZoom(null), VISIBLE_MS)
    })
    return () => {
      unsubscribe()
      clearTimeout(hideTimer.current)
    }
  }, [])

  if (zoom === null) return null
  return <div className={styles.toast}>Zoom {Math.round(zoom * 100)}% · this monitor</div>
}

export default ZoomToast
