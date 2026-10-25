import { useRef } from 'react'
import { useFilterStore } from '../../state/filterStore'
import { ENERGY_LEVELS } from '../../lib/ratings'
import styles from './EnergySidebarSection.module.css'

/** Energy filter as a row of buttons, like the one in the player bar. Click picks one
 *  level (click it again to clear); Shift-click picks everything from the last clicked
 *  level up to this one (3 then Shift 5 = 3-5); Ctrl-click adds or removes a single one. */
function EnergySidebarSection(): React.JSX.Element {
  const selected = useFilterStore((s) => s.selectedEnergyLevels)
  const setEnergyLevels = useFilterStore((s) => s.setEnergyLevels)
  const anchor = useRef<number | null>(null)

  function pick(level: number, event: React.MouseEvent): void {
    if (event.shiftKey) {
      const from = anchor.current ?? selected[0] ?? level
      const lo = Math.min(from, level)
      const hi = Math.max(from, level)
      setEnergyLevels(ENERGY_LEVELS.filter((l) => l >= lo && l <= hi))
      return
    }
    anchor.current = level
    if (event.ctrlKey || event.metaKey) {
      setEnergyLevels(selected.includes(level) ? selected.filter((l) => l !== level) : [...selected, level])
    } else {
      setEnergyLevels(selected.length === 1 && selected[0] === level ? [] : [level])
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {ENERGY_LEVELS.map((level) => {
          const isActive = selected.includes(level)
          return (
            <button
              key={level}
              className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
              title={`Energy ${level} — Shift-click for a range (3 then Shift 5 = 3 to 5)`}
              aria-label={`Energy ${level}`}
              aria-pressed={isActive}
              onClick={(e) => pick(level, e)}
            >
              {level}
            </button>
          )
        })}
      </div>
      <p className={styles.hint}>Shift-click for a range</p>
    </div>
  )
}

export default EnergySidebarSection
