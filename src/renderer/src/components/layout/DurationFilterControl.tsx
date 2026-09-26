import { useEffect, useRef, useState } from 'react'
import { useFilterStore } from '../../state/filterStore'
import { formatDuration } from '../../lib/format'
import styles from './DurationFilterControl.module.css'

const PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Under 1 min', min: null, max: 60 },
  { label: 'Under 2 min', min: null, max: 120 },
  { label: '2–5 min', min: 120, max: 300 },
  { label: 'Over 5 min', min: 300, max: null }
]

function summary(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Duration'
  if (min === null) return `Under ${formatDuration(max)}`
  if (max === null) return `Over ${formatDuration(min)}`
  return `${formatDuration(min)}–${formatDuration(max)}`
}

function DurationFilterControl(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const minDurationSeconds = useFilterStore((s) => s.minDurationSeconds)
  const maxDurationSeconds = useFilterStore((s) => s.maxDurationSeconds)
  const setDurationRange = useFilterStore((s) => s.setDurationRange)

  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')

  useEffect(() => {
    setMinInput(minDurationSeconds !== null ? String(Math.round(minDurationSeconds / 60)) : '')
    setMaxInput(maxDurationSeconds !== null ? String(Math.round(maxDurationSeconds / 60)) : '')
  }, [minDurationSeconds, maxDurationSeconds])

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
    const minMinutes = minInput.trim() === '' ? null : Number(minInput)
    const maxMinutes = maxInput.trim() === '' ? null : Number(maxInput)
    setDurationRange(
      minMinutes !== null && Number.isFinite(minMinutes) ? minMinutes * 60 : null,
      maxMinutes !== null && Number.isFinite(maxMinutes) ? maxMinutes * 60 : null
    )
  }

  const isActive = minDurationSeconds !== null || maxDurationSeconds !== null

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${isActive ? styles.triggerActive : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {summary(minDurationSeconds, maxDurationSeconds)}
      </button>

      {open && (
        <div className={styles.popover}>
          {PRESETS.map((preset) => (
            <div
              key={preset.label}
              className={styles.presetRow}
              onClick={() => {
                setDurationRange(preset.min, preset.max)
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
            <span className={styles.customUnit}>min</span>
          </div>

          {isActive && (
            <div
              className={styles.clearRow}
              onClick={() => {
                setDurationRange(null, null)
                setOpen(false)
              }}
            >
              Clear
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DurationFilterControl
