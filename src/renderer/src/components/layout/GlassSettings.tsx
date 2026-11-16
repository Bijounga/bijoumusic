import { useEffect, useRef, useState } from 'react'
import { useGlassStore } from '../../state/glassStore'
import { useThemeStore } from '../../state/themeStore'
import { GLASS_WALLPAPERS, applyGlassVars, resolveWallpaper } from '../../lib/glass'
import styles from './GlassSettings.module.css'

/** The two Liquid Glass settings, in a popover next to the theme picker: how frosted the
 *  panes are (Clear to Frosted) and which picture sits behind them. */
function GlassSettings(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const theme = useThemeStore((s) => s.theme)
  const frost = useGlassStore((s) => s.frost)
  const wallpaperId = useGlassStore((s) => s.wallpaperId)
  const setFrost = useGlassStore((s) => s.setFrost)
  const setWallpaper = useGlassStore((s) => s.setWallpaper)

  // The slider follows the finger live (just the CSS variable); the setting is saved once it's let go.
  const [liveFrost, setLiveFrost] = useState(frost)
  useEffect(() => setLiveFrost(frost), [frost])

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

  const chosen = resolveWallpaper(wallpaperId, theme)

  function commitFrost(): void {
    if (liveFrost !== frost) setFrost(liveFrost)
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button className={styles.trigger} onClick={() => setOpen((v) => !v)} title="Glass: frost and background">
        Glass
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.heading}>Frost</div>
          <input
            className={styles.slider}
            type="range"
            min={0}
            max={100}
            value={liveFrost}
            aria-label="Frost: Clear to Frosted"
            onChange={(e) => {
              const value = Number(e.target.value)
              setLiveFrost(value)
              applyGlassVars(value, wallpaperId)
            }}
            onPointerUp={commitFrost}
            onKeyUp={commitFrost}
            onBlur={commitFrost}
          />
          <div className={styles.ends}>
            <span>Clear</span>
            <span>Frosted</span>
          </div>

          <div className={styles.heading}>Background</div>
          <div className={styles.grid}>
            {GLASS_WALLPAPERS.map((w) => (
              <button
                key={w.id}
                className={`${styles.thumb} ${w.id === chosen.id ? styles.thumbOn : ''}`}
                style={{ backgroundImage: `url("${w.thumb}")` }}
                title={w.label}
                aria-label={w.label}
                aria-pressed={w.id === chosen.id}
                onClick={() => setWallpaper(w.id)}
              />
            ))}
          </div>
          <div className={styles.caption}>{chosen.label}</div>
        </div>
      )}
    </div>
  )
}

export default GlassSettings
