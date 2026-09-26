import { useMemo, useState } from 'react'
import type { Tag } from '@shared/types'
import { useTagStore } from '../../state/tagStore'
import { useFilterStore } from '../../state/filterStore'
import RenameContextMenu from '../common/RenameContextMenu'
import TagStorageInfoPopover from './TagStorageInfoPopover'
import styles from './TagSidebarSection.module.css'

const UNGROUPED_KEY = -1

interface ContextMenuState {
  x: number
  y: number
}

const DRAG_TAG_MIME = 'application/x-bijoumusic-tag-id'

interface TagRowProps {
  tag: Tag
  count: number
  onDropTag: (draggedId: number, targetId: number) => void
}

function TagRow({ tag, count, onDropTag }: TagRowProps): React.JSX.Element {
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)
  const toggleTag = useFilterStore((s) => s.toggleTag)
  const selectOnlyTag = useFilterStore((s) => s.selectOnlyTag)
  const renameTag = useTagStore((s) => s.renameTag)
  const deleteTag = useTagStore((s) => s.deleteTag)
  const isActive = selectedTagIds.includes(tag.id)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [storageInfo, setStorageInfo] = useState<ContextMenuState | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(tag.name)
  const [isDragOver, setIsDragOver] = useState(false)

  function startRename(): void {
    setRenameValue(tag.name)
    setIsRenaming(true)
  }

  function submitRename(): void {
    setIsRenaming(false)
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === tag.name) return
    void renameTag(tag.id, trimmed)
  }

  if (isRenaming) {
    return (
      <div className={styles.tagRow}>
        <input
          className={styles.renameInput}
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') setIsRenaming(false)
          }}
          onBlur={submitRename}
        />
      </div>
    )
  }

  return (
    <div
      className={`${styles.tagRow} ${isActive ? styles.tagRowActive : ''} ${isDragOver ? styles.tagRowDragOver : ''}`}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) toggleTag(tag.id)
        else selectOnlyTag(tag.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startRename()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TAG_MIME, String(tag.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TAG_MIME)) return
        e.preventDefault()
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TAG_MIME)) return
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        setIsDragOver(false)
        const raw = e.dataTransfer.getData(DRAG_TAG_MIME)
        if (!raw) return
        e.preventDefault()
        const draggedId = Number(raw)
        if (draggedId !== tag.id) onDropTag(draggedId, tag.id)
      }}
    >
      <span className={styles.tagName}>{tag.name}</span>
      <span className={styles.groupCount}>{count}</span>
      <span
        className={styles.deleteTagBtn}
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete tag "${tag.name}"? This removes it from every track.`)) void deleteTag(tag.id)
        }}
      >
        ×
      </span>
      {contextMenu && (
        <RenameContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={startRename}
          onClose={() => setContextMenu(null)}
          extraAction={{
            label: 'Show storage info…',
            onClick: () => setStorageInfo({ x: contextMenu.x, y: contextMenu.y })
          }}
        />
      )}
      {storageInfo && (
        <TagStorageInfoPopover
          x={storageInfo.x}
          y={storageInfo.y}
          tagId={tag.id}
          tagName={tag.name}
          shownCount={count}
          onClose={() => setStorageInfo(null)}
        />
      )}
    </div>
  )
}

interface GroupSectionProps {
  groupId: number | null
  groupName: string
  tags: Tag[]
  tagCounts: Map<number, number>
  forceExpanded?: boolean
}

function GroupSection({ groupId, groupName, tags, tagCounts, forceExpanded }: GroupSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [newTagName, setNewTagName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(groupName)
  const createTag = useTagStore((s) => s.createTag)
  const renameGroup = useTagStore((s) => s.renameGroup)
  const deleteGroup = useTagStore((s) => s.deleteGroup)
  const reorderTags = useTagStore((s) => s.reorderTags)
  const moveTagToGroup = useTagStore((s) => s.moveTagToGroup)
  const isExpanded = forceExpanded || expanded
  const isRenamable = groupId !== null
  const [isHeaderDragOver, setIsHeaderDragOver] = useState(false)

  function submitNewTag(): void {
    const name = newTagName.trim()
    if (!name) return
    void createTag(name, groupId)
    setNewTagName('')
  }

  // Dropping onto a tag already in this group reorders it to sit right before
  // the target. Dropping a tag dragged in from a *different* section moves it
  // into this one first (landing at the end — reordering fine-grained position
  // into place is a separate drag afterward, not combined into this same drop).
  function handleDropTag(draggedId: number, targetId: number): void {
    const order = tags.map((t) => t.id)
    const fromIndex = order.indexOf(draggedId)
    if (fromIndex === -1) {
      void moveTagToGroup(draggedId, groupId)
      return
    }
    const toIndex = order.indexOf(targetId)
    if (toIndex === -1) return
    order.splice(fromIndex, 1)
    order.splice(order.indexOf(targetId), 0, draggedId)
    void reorderTags(order)
  }

  // Dropping straight onto the section header (rather than one of its tags) is
  // the way to move a tag into an empty section, or just without needing to
  // aim for a specific existing tag.
  function handleDropOnHeader(draggedId: number): void {
    if (tags.some((t) => t.id === draggedId)) return
    void moveTagToGroup(draggedId, groupId)
  }

  function startRename(): void {
    if (!isRenamable) return
    setRenameValue(groupName)
    setIsRenaming(true)
  }

  function submitRename(): void {
    setIsRenaming(false)
    if (groupId === null) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === groupName) return
    void renameGroup(groupId, trimmed)
  }

  return (
    <div>
      {isRenaming ? (
        <div className={styles.groupRow}>
          <span className={styles.chevron}>{isExpanded ? '▾' : '▸'}</span>
          <input
            className={styles.renameInput}
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setIsRenaming(false)
            }}
            onBlur={submitRename}
          />
        </div>
      ) : (
        <div
          className={`${styles.groupRow} ${isHeaderDragOver ? styles.groupRowDragOver : ''}`}
          onClick={() => setExpanded((v) => !v)}
          onDoubleClick={(e) => {
            if (!isRenamable) return
            e.stopPropagation()
            startRename()
          }}
          onContextMenu={(e) => {
            if (!isRenamable) return
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY })
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TAG_MIME)) return
            e.preventDefault()
          }}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TAG_MIME)) return
            setIsHeaderDragOver(true)
          }}
          onDragLeave={() => setIsHeaderDragOver(false)}
          onDrop={(e) => {
            setIsHeaderDragOver(false)
            const raw = e.dataTransfer.getData(DRAG_TAG_MIME)
            if (!raw) return
            e.preventDefault()
            handleDropOnHeader(Number(raw))
          }}
        >
          <span className={styles.chevron}>{isExpanded ? '▾' : '▸'}</span>
          <span className={styles.groupName}>{groupName}</span>
          <span className={styles.groupCount}>{tags.length}</span>
          {groupId !== null && (
            <span
              className={styles.deleteGroupBtn}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete section "${groupName}"? Its tags become ungrouped, not deleted.`)) {
                  void deleteGroup(groupId)
                }
              }}
            >
              ×
            </span>
          )}
        </div>
      )}
      {contextMenu && (
        <RenameContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={startRename}
          onClose={() => setContextMenu(null)}
        />
      )}
      {isExpanded && (
        <>
          {tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} count={tagCounts.get(tag.id) ?? 0} onDropTag={handleDropTag} />
          ))}
          <div className={styles.addTagRow}>
            <input
              className={styles.addTagInput}
              placeholder="+ tag…"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewTag()
              }}
              onBlur={submitNewTag}
            />
          </div>
        </>
      )}
    </div>
  )
}

function TagSidebarSection(): React.JSX.Element {
  const groups = useTagStore((s) => s.groups)
  const tags = useTagStore((s) => s.tags)
  const trackTags = useTagStore((s) => s.trackTags)
  const createGroup = useTagStore((s) => s.createGroup)
  const [newGroupName, setNewGroupName] = useState('')
  const [query, setQuery] = useState('')

  const tagCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const tagIds of trackTags.values()) {
      for (const tagId of tagIds) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
      }
    }
    return counts
  }, [trackTags])

  const tagsByGroup = useMemo(() => {
    const map = new Map<number, Tag[]>()
    const ungrouped: Tag[] = []
    for (const tag of tags) {
      if (tag.groupId === null) {
        ungrouped.push(tag)
      } else {
        if (!map.has(tag.groupId)) map.set(tag.groupId, [])
        map.get(tag.groupId)!.push(tag)
      }
    }
    map.set(UNGROUPED_KEY, ungrouped)
    return map
  }, [tags])

  function submitNewGroup(): void {
    const name = newGroupName.trim()
    if (!name) return
    void createGroup(name)
    setNewGroupName('')
  }

  const trimmedQuery = query.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!trimmedQuery) {
      return groups.map((group) => ({ group, tags: tagsByGroup.get(group.id) ?? [] }))
    }
    return groups
      .map((group) => {
        const groupNameMatches = group.name.toLowerCase().includes(trimmedQuery)
        const groupTags = tagsByGroup.get(group.id) ?? []
        const tags = groupNameMatches
          ? groupTags
          : groupTags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery))
        return { group, tags }
      })
      .filter(({ tags }) => tags.length > 0)
  }, [groups, tagsByGroup, trimmedQuery])

  const allUngroupedTags = tagsByGroup.get(UNGROUPED_KEY) ?? []
  const filteredUngroupedTags = trimmedQuery
    ? allUngroupedTags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery))
    : allUngroupedTags

  const nothingMatches = trimmedQuery.length > 0 && filteredGroups.length === 0 && filteredUngroupedTags.length === 0

  return (
    <div>
      <input
        className={styles.searchInput}
        placeholder="Search tags…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {filteredGroups.map(({ group, tags }) => (
        <GroupSection
          key={group.id}
          groupId={group.id}
          groupName={group.name}
          tags={tags}
          tagCounts={tagCounts}
          forceExpanded={trimmedQuery.length > 0}
        />
      ))}
      {filteredUngroupedTags.length > 0 && (
        <GroupSection
          groupId={null}
          groupName="Other"
          tags={filteredUngroupedTags}
          tagCounts={tagCounts}
          forceExpanded={trimmedQuery.length > 0}
        />
      )}
      {nothingMatches && <div className={styles.emptyHint}>No tags match "{query.trim()}"</div>}
      {groups.length === 0 && allUngroupedTags.length === 0 && (
        <div className={styles.emptyHint}>No tags yet — add a section to start</div>
      )}
      <div className={styles.newGroupRow}>
        <input
          className={styles.addTagInput}
          placeholder="+ New section…"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNewGroup()
          }}
          onBlur={submitNewGroup}
        />
      </div>
    </div>
  )
}

export default TagSidebarSection
