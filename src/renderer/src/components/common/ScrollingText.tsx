import { useEffect, useRef, useState } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import styles from './ScrollingText.module.css'

interface ScrollingTextProps {
  text: string
  /** Marquee-scroll when true and the text actually overflows its container;
   *  otherwise it just ellipsizes and relies on the title-attribute tooltip. */
  scroll?: boolean
  className?: string
}

/** Long names ellipsis-truncate by default. When `scroll` is set and the text
 *  actually overflows its container, it marquees instead — but only while music
 *  is playing. A never-ending marquee kept the whole window re-compositing 60
 *  times a second even when idle (~25% of a CPU core at a small window size, far
 *  more full-screen on a 4K display). Any truncated name still shows the full
 *  text on hover via the native title tooltip. */
function ScrollingText({ text, scroll = false, className }: ScrollingTextProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  useEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    setOverflowing(measure.scrollWidth > container.clientWidth)
  }, [text])

  const shouldScroll = scroll && overflowing && isPlaying

  return (
    <div className={`${styles.container} ${className ?? ''}`} ref={containerRef} title={text}>
      <span ref={measureRef} className={styles.measure}>
        {text}
      </span>
      {shouldScroll ? (
        <span className={`${styles.track} ${styles.scrolling}`}>
          <span className={styles.segment}>{text}</span>
          <span className={styles.segment}>{text}</span>
        </span>
      ) : (
        <span className={styles.static}>{text}</span>
      )}
    </div>
  )
}

export default ScrollingText
