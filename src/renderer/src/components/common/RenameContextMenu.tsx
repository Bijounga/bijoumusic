import { useEffect, useRef } from 'react'
import styles from './RenameContextMenu.module.css'

interface RenameContextMenuProps {
  x: number
  y: number
  onRename: () => void
  onClose: () => void
  /** One additional item below Rename — used for tags' "Show storage info".
   *  Kept as a single optional slot rather than a generic items array since
   *  Rename is still the only action every row using this menu needs. */
  extraAction?: { label: string; onClick: () => void }
}

/** A minimal right-click menu for a sidebar row (tag, tag section, project) —
 *  "Rename" always, plus optionally one more action; delete already has its own
 *  hover-x affordance on these rows so it's never needed here. */
function RenameContextMenu({ x, y, onRename, onClose, extraAction }: RenameContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div className={styles.menu} ref={menuRef} style={{ left: x, top: y }}>
      <div
        className={styles.menuItem}
        onClick={() => {
          onRename()
          onClose()
        }}
      >
        Rename
      </div>
      {extraAction && (
        <div
          className={styles.menuItem}
          onClick={() => {
            extraAction.onClick()
            onClose()
          }}
        >
          {extraAction.label}
        </div>
      )}
    </div>
  )
}

export default RenameContextMenu
