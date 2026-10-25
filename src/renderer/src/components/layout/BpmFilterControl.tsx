import { useEffect, useRef, useState } from 'react'
import { useFilterStore } from '../../state/filterStore'
import { useLibraryStore } from '../../state/libraryStore'
import styles from './DurationFilterControl.module.css'

const PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Under 100', min: null, max: 100 },
  { label: '100–130', min: 100, max: 130 },
  { label: '130–160', min: 130, max: 160 },
  { label: 'Over 160', min: 160, max: null }
]

function summary(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'BPM'
  if (min === null) return `Under ${max} BPM`
  if (max === null) return `Over ${min} BPM`
  return `${min}–${max} BPM`
}

/** Filters the list to songs in a tempo range — the same kind of control as Duration. */
function BpmFilterControl(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const minBpm = useFilterStore((s) => s.minBpm)
  const maxBpm = useFilterStore((s) => s.maxBpm)
  const setBpmRange = useFilterStore((s) => s.setBpmRange)
  // Tempos are worked out in the background; songs still waiting can't match yet.
  const pending = useLibraryStore((s) => s.tracks.reduce((n, t) => (t.bpm === null ? n + 1 : n), 0))

  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')

  useEffect(() => {
    setMinInput(minBpm !== null ? String(minBpm) : '')
    setMaxInput(maxBpm !== null ? String(maxBpm) : '')
  }, [minBpm, maxBpm])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  function applyCustomRange(): void {
    const min = minInput.trim() === '' ? null : Number(minInput)
    const max = maxInput.trim() === '' ? null : Number(maxInput)
    setBpmRange(min !== null && Number.isFinite(min) ? min : null, max !== null && Number.isFinite(max) ? max : null)
  }

  const isActive = minBpm !== null || maxBpm !== null

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button className={`${styles.trigger} ${isActive ? styles.triggerActive : ''}`} onClick={() => setOpen((v) => !v)}>
        {summary(minBpm, maxBpm)}
      </button>

      {open && (
        <div className={styles.popover}>
          {PRESETS.map((preset) => (
            <div
              key={preset.label}
              className={styles.presetRow}
              onClick={() => {
                setBpmRange(preset.min, preset.max)
                setOpen(false)
              }}
            >
              {preset.label}
            </div>
          ))}

          <div className={styles.customRow}>
            <input
              className={styles.numberInput}
              type="number"
              min={0}
              placeholder="Min"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              onBlur={applyCustomRange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCustomRange()
              }}
            />
            <span className={styles.customUnit}>to</span>
            <input
              className={styles.numberInput}
              type="number"
              min={0}
              placeholder="Max"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              onBlur={applyCustomRange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCustomRange()
              }}
            />
            <span className={styles.customUnit}>BPM</span>
          </div>

          {isActive && (
            <div
              className={styles.clearRow}
              onClick={() => {
                setBpmRange(null, null)
                setOpen(false)
              }}
            >
              Clear
            </div>
          )}

          {pending > 0 && (
            <div className={styles.note}>
              {pending} song{pending === 1 ? '' : 's'} still waiting for a tempo — they show up here once it's worked out.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BpmFilterControl
