import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { useTagStore } from '../../state/tagStore'
import styles from './TagEditorPopover.module.css'

function TagEditorPopover({ track }: { track: Track | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const groups = useTagStore((s) => s.groups)
  const tags = useTagStore((s) => s.tags)
  const trackTags = useTagStore((s) => s.trackTags)
  const addTrackTag = useTagStore((s) => s.addTrackTag)
  const removeTrackTag = useTagStore((s) => s.removeTrackTag)
  const createTag = useTagStore((s) => s.createTag)

  const assignedIds = track ? (trackTags.get(track.id) ?? new Set<number>()) : new Set<number>()

  const trimmedQuery = query.trim().toLowerCase()
  const filteredTags = useMemo(() => {
    if (!trimmedQuery) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(trimmedQuery))
  }, [tags, trimmedQuery])

  const tagsByGroup = useMemo(() => {
    const map = new Map<number | null, typeof tags>()
    for (const tag of filteredTags) {
      const key = tag.groupId
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tag)
    }
    return map
  }, [filteredTags])

  const exactMatchExists = tags.some((t) => t.name.toLowerCase() === trimmedQuery)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  function toggle(tagId: number): void {
    if (!track) return
    if (assignedIds.has(tagId)) void removeTrackTag(track.id, tagId)
    else void addTrackTag(track.id, tagId)
  }

  async function submitNewTag(): Promise<void> {
    const name = query.trim()
    if (!name || !track || exactMatchExists) return
    const tag = await createTag(name, null)
    await addTrackTag(track.id, tag.id)
    setQuery('')
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${assignedIds.size > 0 ? styles.triggerActive : ''}`}
        disabled={!track}
        onClick={() => setOpen((v) => !v)}
      >
        {assignedIds.size > 0 ? `Tags (${assignedIds.size})` : 'Tags'}
      </button>

      {open && track && (
        <div className={styles.popover}>
          <input
            className={styles.searchInput}
            placeholder="Search or create a tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmedQuery && !exactMatchExists) void submitNewTag()
            }}
            autoFocus
          />
          {groups.map((group) => {
            const groupTags = tagsByGroup.get(group.id) ?? []
            if (groupTags.length === 0) return null
            return (
              <div key={group.id}>
                <p className={styles.groupHeading}>{group.name}</p>
                {groupTags.map((tag) => (
                  <div key={tag.id} className={styles.checkRow} onClick={() => toggle(tag.id)}>
                    <span className={`${styles.checkbox} ${assignedIds.has(tag.id) ? styles.checkboxChecked : ''}`}>
                      {assignedIds.has(tag.id) ? '✓' : ''}
                    </span>
                    <span className={styles.checkLabel}>{tag.name}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {(tagsByGroup.get(null) ?? []).length > 0 && (
            <div>
              <p className={styles.groupHeading}>Other</p>
              {(tagsByGroup.get(null) ?? []).map((tag) => (
                <div key={tag.id} className={styles.checkRow} onClick={() => toggle(tag.id)}>
                  <span className={`${styles.checkbox} ${assignedIds.has(tag.id) ? styles.checkboxChecked : ''}`}>
                    {assignedIds.has(tag.id) ? '✓' : ''}
                  </span>
                  <span className={styles.checkLabel}>{tag.name}</span>
                </div>
              ))}
            </div>
          )}
          {tags.length === 0 && <p className={styles.emptyHint}>No tags yet — type above to create one</p>}
          {tags.length > 0 && filteredTags.length === 0 && (
            <p className={styles.emptyHint}>No tags match "{query.trim()}"</p>
          )}
          {trimmedQuery && !exactMatchExists && (
            <div className={styles.createRow} onClick={() => void submitNewTag()}>
              + Create &quot;{query.trim()}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TagEditorPopover
