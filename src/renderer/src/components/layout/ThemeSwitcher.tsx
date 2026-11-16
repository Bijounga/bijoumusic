import { useThemeStore, type ThemeId } from '../../state/themeStore'
import { isGlassTheme } from '../../lib/glass'
import GlassSettings from './GlassSettings'
import styles from './ThemeSwitcher.module.css'

const THEME_LABELS: Record<ThemeId, string> = {
  dark: 'Dark',
  'frutiger-luna': 'Frutiger Aero',
  'frutiger-aero-dark': 'Frutiger Aero Dark',
  'frutiger-aqua': 'Frutiger Aqua',
  'vaporwave-95': 'Vaporwave 95',
  'y2k-chrome': 'Y2K Chrome',
  'liquid-glass': 'Liquid Glass',
  'liquid-glass-dark': 'Liquid Glass Dark',
  'soft-3d': 'Soft 3D',
  'soft-3d-dark': 'Soft 3D Dark',
  'techno-flat': 'Techno Flat'
}

function ThemeSwitcher(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className={styles.group}>
      {isGlassTheme(theme) && <GlassSettings />}
      <select className={styles.select} value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)} title="Theme">
        {(Object.keys(THEME_LABELS) as ThemeId[]).map((id) => (
          <option key={id} value={id}>
            {THEME_LABELS[id]}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ThemeSwitcher
