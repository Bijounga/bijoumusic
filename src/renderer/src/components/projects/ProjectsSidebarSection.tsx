import { useState } from 'react'
import type { Project } from '@shared/types'
import { useProjectStore } from '../../state/projectStore'
import { useFilterStore } from '../../state/filterStore'
import { useRecentActivityStore } from '../../state/recentActivityStore'
import { DRAG_FOLDER_MIME } from '../../lib/dragMimes'
import RenameContextMenu from '../common/RenameContextMenu'
import styles from './ProjectsSidebarSection.module.css'

interface ContextMenuState {
  x: number
  y: number
}

function ProjectRow({ project, isActive }: { project: Project; isActive: boolean }): React.JSX.Element {
  const projectTracks = useProjectStore((s) => s.projectTracks)
  const renameProject = useProjectStore((s) => s.renameProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const setActiveProject = useFilterStore((s) => s.setActiveProject)
  const loadProjectTrackIds = useProjectStore((s) => s.loadProjectTrackIds)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(project.name)
  // Something is being dragged over this project / what the last drop added.
  const [dropHover, setDropHover] = useState(false)
  const [dropNote, setDropNote] = useState<string | null>(null)
  const loadAllProjects = useProjectStore((s) => s.loadAll)

  function startRename(): void {
    setRenameValue(project.name)
    setIsRenaming(true)
  }

  function submitRename(): void {
    setIsRenaming(false)
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === project.name) return
    void renameProject(project.id, trimmed)
  }

  // Song rows are dragged with the native file drag (the one that drops into
  // Premiere), which reaches the page as files; a folder from the folder tree
  // carries its own marker. Anything else is ignored.
  function isProjectDrop(e: React.DragEvent): boolean {
    const types = Array.from(e.dataTransfer.types)
    return types.includes('Files') || types.includes(DRAG_FOLDER_MIME)
  }

  async function handleDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDropHover(false)
    const folderJson = e.dataTransfer.getData(DRAG_FOLDER_MIME)
    const dropped = folderJson
      ? { folder: JSON.parse(folderJson) as { libraryRootId: number; relativePath: string } }
      : { paths: Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f)).filter(Boolean) }
    const result = await window.api.addDroppedToProject(project.id, dropped)
    await loadAllProjects()
    void useRecentActivityStore.getState().loadMostUsed()
    // If this project is the one being browsed, show the new songs.
    if (useFilterStore.getState().selectedProjectId === project.id) void loadProjectTrackIds(project.id)
    setDropNote(
      result.total === 0
        ? 'nothing to add'
        : result.added === 0
          ? 'already in'
          : `+${result.added}`
    )
    setTimeout(() => setDropNote(null), 2200)
  }

  if (isRenaming) {
    return (
      <div className={styles.row}>
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
      className={`${styles.row} ${isActive ? styles.rowActive : ''} ${dropHover ? styles.rowDrop : ''}`}
      onDragEnter={(e) => {
        if (isProjectDrop(e)) setDropHover(true)
      }}
      onDragOver={(e) => {
        if (!isProjectDrop(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        // Moving onto a child of the row also fires this; only a real exit counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false)
      }}
      onDrop={(e) => {
        if (isProjectDrop(e)) void handleDrop(e)
      }}
      onClick={() => {
        setActiveProject(project.id)
        void loadProjectTrackIds(project.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startRename()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <span className={styles.name}>{project.name}</span>
      <span className={styles.count}>{dropNote ?? projectTracks.get(project.id)?.size ?? 0}</span>
      <span
        className={styles.deleteBtn}
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete project "${project.name}"? This can't be undone.`)) {
            void deleteProject(project.id)
          }
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
        />
      )}
    </div>
  )
}

function ProjectsSidebarSection(): React.JSX.Element {
  const [newProjectName, setNewProjectName] = useState('')

  const projects = useProjectStore((s) => s.projects)
  const createProject = useProjectStore((s) => s.createProject)

  const activeView = useFilterStore((s) => s.activeView)
  const selectedProjectId = useFilterStore((s) => s.selectedProjectId)

  function submitNewProject(): void {
    const name = newProjectName.trim()
    if (!name) return
    void createProject(name)
    setNewProjectName('')
  }

  return (
    <div>
      {projects.length === 0 && <div className={styles.emptyHint}>No projects yet — add one below</div>}
      {projects.map((project) => (
        <ProjectRow
          key={project.id}
          project={project}
          isActive={activeView === 'project' && selectedProjectId === project.id}
        />
      ))}
      <div className={styles.newProjectRow}>
        <input
          className={styles.newProjectInput}
          placeholder="+ New project…"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNewProject()
          }}
          onBlur={submitNewProject}
        />
      </div>
    </div>
  )
}

export default ProjectsSidebarSection
