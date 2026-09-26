import { useEffect, useRef } from 'react'
import type { Track } from '@shared/types'
import { useCachedWaveformPeaks } from '../../audio/useCachedWaveformPeaks'
import { useTrackTagColors } from '../../hooks/useTrackTagColors'
import { waveformFillStyle } from '../../lib/tagColors'
import { useWaveformIntensityStore } from '../../state/waveformIntensityStore'
import styles from './TrackList.module.css'

const DEFAULT_BAR_COLOR = 'rgba(167, 177, 191, 0.55)'

function RowWaveform({ track }: { track: Track }): React.JSX.Element {
  const peaks = useCachedWaveformPeaks(track)
  const tagColors = useTrackTagColors(track.id)
  const intensity = useWaveformIntensityStore((s) => s.intensity)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = waveformFillStyle(ctx, width, tagColors, DEFAULT_BAR_COLOR, intensity)

    // Downsample the full-resolution peaks to however many bars actually fit.
    const targetBars = Math.max(1, Math.floor(width / 2))
    const sourceBuckets = peaks.length / 2
    const step = sourceBuckets / targetBars
    const midY = height / 2

    for (let i = 0; i < targetBars; i++) {
      const start = Math.floor(i * step)
      const end = Math.max(start + 1, Math.floor((i + 1) * step))
      let min = 0
      let max = 0
      for (let j = start; j < end && j < sourceBuckets; j++) {
        const bMin = peaks[j * 2]
        const bMax = peaks[j * 2 + 1]
        if (bMin < min) min = bMin
        if (bMax > max) max = bMax
      }
      const barHeight = Math.max((max - min) * height * 0.5, 1)
      ctx.fillRect(i * 2, midY - barHeight / 2, 1, barHeight)
    }
  }, [peaks, tagColors, intensity])

  if (!peaks) return <div className={styles.rowWaveformEmpty} />

  return <canvas ref={canvasRef} className={styles.rowWaveformCanvas} />
}

export default RowWaveform
