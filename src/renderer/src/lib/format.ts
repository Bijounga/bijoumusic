export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** "128 BPM", or null when the tempo isn't known or the song has no steady beat. */
export function formatBpm(bpm: number | null): string | null {
  if (bpm === null || bpm <= 0) return null
  return `${Math.round(bpm)} BPM`
}
