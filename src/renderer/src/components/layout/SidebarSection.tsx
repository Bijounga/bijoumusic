import { useState, type ReactNode } from 'react'
import { setSetting } from '../../lib/settingsSync'
import styles from './SidebarSection.module.css'

function loadExpanded(storageKey: string): boolean {
  try {
    const stored = localStorage.getItem(`bijoumusic:section:${storageKey}`)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

function saveExpanded(storageKey: string, expanded: boolean): void {
  try {
    setSetting(`bijoumusic:section:${storageKey}`, expanded ? '1' : '0')
  } catch {
    // Non-fatal — just won't remember the collapsed state across restarts.
  }
}

interface SidebarSectionProps {
  title: string
  accentColor: string
  storageKey: string
  /** Extra controls in the heading row (e.g. "+ Add") that shouldn't toggle collapse. */
  extra?: ReactNode
  children: ReactNode
}

/** Every sidebar section (Library, Favorites, Energy, Folders, Tags, Projects,
 *  Keybinds) shares this shell: a colored heading (for at-a-glance differentiation),
 *  collapsible at the section level, remembering its state across restarts. */
function SidebarSection({ title, accentColor, storageKey, extra, children }: SidebarSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(() => loadExpanded(storageKey))

  function toggle(): void {
    const next = !expanded
    setExpanded(next)
    saveExpanded(storageKey, next)
  }

  return (
    <div className={styles.section}>
      <div className={styles.headingRow} onClick={toggle}>
        <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
        <p className={styles.heading} style={{ color: accentColor }}>
          {title}
        </p>
        {extra && (
          <span className={styles.extra} onClick={(e) => e.stopPropagation()}>
            {extra}
          </span>
        )}
      </div>
      {expanded && children}
    </div>
  )
}

export default SidebarSection
