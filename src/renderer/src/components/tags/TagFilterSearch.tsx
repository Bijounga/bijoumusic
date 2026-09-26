import { useEffect, useMemo, useRef, useState } from 'react'
import { useTagStore } from '../../state/tagStore'
import { useFilterStore } from '../../state/filterStore'
import styles from './TagFilterSearch.module.css'

/** A quick tag picker: type to search across every tag regardless of which section
 *  it's in, click any number of matches to add them to the active filter. Stays open
 *  across multiple picks — only closes on click-outside or Escape — so you can grab
 *  several tags in one pass instead of reopening it each time. */
function TagFilterSearch(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const tags = useTagStore((s) => s.tags)
  const groups = useTagStore((s) => s.groups)
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)
  const toggleTag = useFilterStore((s) => s.toggleTag)

  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => {
      if (t.name.toLowerCase().includes(q)) return true
      // Typing a section name (e.g. "games") should surface every tag in that
      // section, even ones whose own name doesn't contain the query.
      const groupName = t.groupId !== null ? groupNameById.get(t.groupId) : null
      return groupName ? groupName.toLowerCase().includes(q) : false
    })
  }, [tags, query, groupNameById])

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

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <input
        className={styles.input}
        placeholder="Search tags…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
      />
      {open && (
        <div className={styles.dropdown}>
          {filtered.length === 0 && <div className={styles.emptyHint}>No matching tags</div>}
          {filtered.map((tag) => {
            const isActive = selectedTagIds.includes(tag.id)
            const groupName = tag.groupId !== null ? groupNameById.get(tag.groupId) : null
            return (
              <div key={tag.id} className={styles.row} onClick={() => toggleTag(tag.id)}>
                <span className={`${styles.checkbox} ${isActive ? styles.checkboxChecked : ''}`}>
                  {isActive ? '✓' : ''}
                </span>
                <span className={styles.rowLabel}>{tag.name}</span>
                {groupName && <span className={styles.rowGroup}>{groupName}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default TagFilterSearch
