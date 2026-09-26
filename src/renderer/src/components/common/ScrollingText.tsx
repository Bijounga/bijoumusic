import { useEffect, useRef, useState } from 'react'
import styles from './ScrollingText.module.css'

interface ScrollingTextProps {
  text: string
  /** Marquee-scroll when true and the text actually overflows its container;
   *  otherwise it just ellipsizes and relies on the title-attribute tooltip. */
  scroll?: boolean
  className?: string
}

/** Long names ellipsis-truncate by default. When `scroll` is set and the text
 *  actually overflows its container, it marquees instead; any truncated name still
 *  shows the full text on hover via the native title tooltip. */
function ScrollingText({ text, scroll = false, className }: ScrollingTextProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    setOverflowing(measure.scrollWidth > container.clientWidth)
  }, [text])

  const shouldScroll = scroll && overflowing

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
