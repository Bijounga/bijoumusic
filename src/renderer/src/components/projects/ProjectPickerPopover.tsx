import { useEffect, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { useProjectStore } from '../../state/projectStore'
import styles from './ProjectPickerPopover.module.css'

function ProjectPickerPopover({ track }: { track: Track | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const projects = useProjectStore((s) => s.projects)
  const projectTracks = useProjectStore((s) => s.projectTracks)
  const createProject = useProjectStore((s) => s.createProject)
  const addTrackToProject = useProjectStore((s) => s.addTrackToProject)
  const removeTrackFromProject = useProjectStore((s) => s.removeTrackFromProject)

  const assignedProjectIds = track
    ? new Set(projects.filter((p) => projectTracks.get(p.id)?.has(track.id)).map((p) => p.id))
    : new Set<number>()

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

  function toggle(projectId: number): void {
    if (!track) return
    if (assignedProjectIds.has(projectId)) void removeTrackFromProject(projectId, track.id)
    else void addTrackToProject(projectId, track.id)
  }

  async function submitNewProject(): Promise<void> {
    const name = newProjectName.trim()
    if (!name || !track) return
    const project = await createProject(name)
    await addTrackToProject(project.id, track.id)
    setNewProjectName('')
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${assignedProjectIds.size > 0 ? styles.triggerActive : ''}`}
        disabled={!track}
        onClick={() => setOpen((v) => !v)}
      >
        {assignedProjectIds.size > 0 ? `Projects (${assignedProjectIds.size})` : 'Projects'}
      </button>

      {open && track && (
        <div className={styles.popover}>
          {projects.length === 0 && <p className={styles.emptyHint}>No projects yet — create one below</p>}
          {projects.map((project) => (
            <div key={project.id} className={styles.checkRow} onClick={() => toggle(project.id)}>
              <span
                className={`${styles.checkbox} ${assignedProjectIds.has(project.id) ? styles.checkboxChecked : ''}`}
              >
                {assignedProjectIds.has(project.id) ? '✓' : ''}
              </span>
              <span className={styles.checkLabel}>{project.name}</span>
            </div>
          ))}
          <input
            className={styles.newProjectInput}
            placeholder="+ new project…"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewProject()
            }}
          />
        </div>
      )}
    </div>
  )
}

export default ProjectPickerPopover
