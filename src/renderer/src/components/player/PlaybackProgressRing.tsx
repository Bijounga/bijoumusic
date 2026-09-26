import { useEffect, useRef, type ReactNode } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import { audioEngine } from '../../audio/AudioEngine'
import styles from './PlaybackProgressRing.module.css'

interface PlaybackProgressRingProps {
  size: number
  children: ReactNode
}

/** Wraps anything (the play/pause button, album art, whatever) in a ring that
 *  fills clockwise as the current track plays — read directly off the audio engine
 *  every frame (bypassing React state) rather than off the store's currentTime,
 *  same reasoning as the waveform playhead: smooth motion without a re-render
 *  per frame. */
function PlaybackProgressRing({ size, children }: PlaybackProgressRingProps): React.JSX.Element {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const circleRef = useRef<SVGCircleElement>(null)

  const radius = size / 2 - 2
  const circumference = 2 * Math.PI * radius

  useEffect(() => {
    if (!currentTrack) {
      if (circleRef.current) circleRef.current.style.strokeDashoffset = String(circumference)
      return
    }

    let rafId: number
    const tick = (): void => {
      const duration = audioEngine.getDuration()
      const fraction = duration > 0 ? audioEngine.getCurrentTime() / duration : 0
      if (circleRef.current) {
        circleRef.current.style.strokeDashoffset = String(circumference * (1 - Math.min(1, Math.max(0, fraction))))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [currentTrack, circumference])

  const center = size / 2

  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      {children}
      <svg className={styles.ring} viewBox={`0 0 ${size} ${size}`}>
        <circle className={styles.ringTrack} cx={center} cy={center} r={radius} />
        <circle
          ref={circleRef}
          className={styles.ringProgress}
          cx={center}
          cy={center}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
    </div>
  )
}

export default PlaybackProgressRing
