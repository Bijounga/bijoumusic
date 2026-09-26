import { useThemeStore, type ThemeId } from '../../state/themeStore'
import styles from './ThemeSwitcher.module.css'

const THEME_LABELS: Record<ThemeId, string> = {
  dark: 'Dark',
  'frutiger-luna': 'Frutiger Aero',
  'frutiger-aero-dark': 'Frutiger Aero Dark'
}

function ThemeSwitcher(): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <select
      className={styles.select}
      value={theme}
      onChange={(e) => setTheme(e.target.value as ThemeId)}
      title="Theme"
    >
      {(Object.keys(THEME_LABELS) as ThemeId[]).map((id) => (
        <option key={id} value={id}>
          {THEME_LABELS[id]}
        </option>
      ))}
    </select>
  )
}

export default ThemeSwitcher
