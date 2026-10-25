import { useEffect, useRef, useState } from 'react'
import type { FolderNode } from '../../lib/folderTree'
import { useFilterStore } from '../../state/filterStore'
import { useLibraryStore } from '../../state/libraryStore'
import { DRAG_FOLDER_MIME } from '../../lib/dragMimes'
import FolderIcon from './FolderIcon'
import styles from './FolderTree.module.css'

interface ContextMenuState {
  x: number
  y: number
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }): React.JSX.Element {
  const [expandedState, setExpanded] = useState(false)
  const expanded = node.forceExpanded || expandedState
  const selectedFolder = useFilterStore((s) => s.selectedFolder)
  const setSelectedFolder = useFilterStore((s) => s.setSelectedFolder)
  const rescanFolder = useLibraryStore((s) => s.rescanFolder)
  const loadInitial = useLibraryStore((s) => s.loadInitial)
  const rescan = useLibraryStore((s) => s.rescan)
  const isActive =
    selectedFolder?.libraryRootId === node.libraryRootId && selectedFolder?.relativePath === node.relativePath
  const hasChildren = node.children.length > 0

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  // Only a library's top folder can be re-pointed (depth 0 is a root).
  const isLibraryRoot = depth === 0 && node.relativePath === ''

  async function moveLibraryFolder(): Promise<void> {
    const picked = await window.api.pickLibraryFolder()
    if (!picked) return
    const report = await window.api.libraryAnalyzeMoveRoot(node.libraryRootId, picked)
    if (report.error) {
      const hint = report.suggestedPath ? ['', 'Did you mean this folder?', report.suggestedPath] : []
      alert([report.error, ...hint].join('\n'))
      return
    }
    const lines = [
      `Move "${node.name}" to:`,
      report.newPath,
      '',
      `${report.found.toLocaleString()} of ${report.total.toLocaleString()} songs were found there. They keep all their tags, ratings and aliases and simply point at the new files.`
    ]
    if (report.missing > 0) {
      lines.push(
        '',
        `${report.missing.toLocaleString()} weren't found. They stay in your library marked missing, and reconnect on their own if the files show up later.`,
        '',
        'For example, not found there:',
        ...report.missingSamples.slice(0, 4)
      )
    }
    lines.push('', 'Your original files are not touched.')
    if (!confirm(lines.join('\n'))) return
    try {
      const result = await window.api.libraryApplyMoveRoot(node.libraryRootId, picked)
      await loadInitial()
      void rescan(report.newPath)
      alert(`Moved ${result.moved.toLocaleString()} songs to the new folder.`)
    } catch (err) {
      alert(`Couldn't move the folder: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <>
      <div
        className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() =>
          setSelectedFolder(
            isActive ? null : { libraryRootId: node.libraryRootId, relativePath: node.relativePath }
          )
        }
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        // Drag the folder onto a project in the sidebar to add every song in it.
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_FOLDER_MIME, JSON.stringify({ libraryRootId: node.libraryRootId, relativePath: node.relativePath }))
          e.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {hasChildren ? (
          <span
            className={styles.chevron}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}
        <span className={styles.folderIcon}>
          <FolderIcon />
        </span>
        <span className={styles.name}>{node.name}</span>
        <span className={styles.count}>{node.count}</span>
      </div>
      {contextMenu && (
        <div className={styles.contextMenu} ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div
            className={styles.contextMenuItem}
            onClick={() => {
              void rescanFolder(node.libraryRootId, node.relativePath)
              setContextMenu(null)
            }}
          >
            Rescan this folder
          </div>
          {isLibraryRoot && (
            <div
              className={styles.contextMenuItem}
              onClick={() => {
                setContextMenu(null)
                void moveLibraryFolder()
              }}
            >
              Move library folder…
            </div>
          )}
        </div>
      )}
      {expanded && node.children.map((child) => <FolderRow key={child.path} node={child} depth={depth + 1} />)}
    </>
  )
}

interface FolderTreeProps {
  nodes: FolderNode[]
  collapseSignal: number
  isFiltered?: boolean
}

function FolderTree({ nodes, collapseSignal, isFiltered }: FolderTreeProps): React.JSX.Element {
  if (nodes.length === 0) {
    return <div className={styles.emptyHint}>{isFiltered ? 'No folders match' : 'Add a folder to begin'}</div>
  }
  return (
    // Remounting on collapseSignal resets every row's local `expanded` state back
    // to false in one shot — the only way to "collapse all" without lifting each
    // node's expand state into a shared store.
    <div key={collapseSignal}>
      {nodes.map((node) => (
        <FolderRow key={node.path} node={node} depth={0} />
      ))}
    </div>
  )
}

export default FolderTree
