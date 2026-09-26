import { getDb } from '../database'
import { logPlaybackEvent } from './playbackRepo'

export interface ProjectRow {
  id: number
  name: string
  created_at: number
  updated_at: number
  archived: number
}

export interface ProjectTrackAssignmentRow {
  project_id: number
  track_id: number
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC').all() as ProjectRow[]
}

export function createProject(name: string): ProjectRow {
  const now = Date.now()
  const result = getDb()
    .prepare('INSERT INTO projects (name, created_at, updated_at, archived) VALUES (?, ?, ?, 0)')
    .run(name, now, now)
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as ProjectRow
}

export function renameProject(id: number, name: string): void {
  getDb().prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function listTrackIdsForProject(projectId: number): number[] {
  const rows = getDb()
    .prepare('SELECT track_id FROM project_tracks WHERE project_id = ? ORDER BY added_at DESC')
    .all(projectId) as { track_id: number }[]
  return rows.map((r) => r.track_id)
}

export function listAllProjectTrackAssignments(): ProjectTrackAssignmentRow[] {
  return getDb().prepare('SELECT project_id, track_id FROM project_tracks').all() as ProjectTrackAssignmentRow[]
}

export function addTrackToProject(projectId: number, trackId: number): void {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO project_tracks (project_id, track_id, added_at) VALUES (?, ?, ?)').run(
    projectId,
    trackId,
    Date.now()
  )
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  logPlaybackEvent(trackId, 'added_to_project')
}

export function removeTrackFromProject(projectId: number, trackId: number): void {
  getDb().prepare('DELETE FROM project_tracks WHERE project_id = ? AND track_id = ?').run(projectId, trackId)
}

const MOST_USED_LIMIT = 100

/** "Most Used" ranks by project usage, not play count — a track auditioned many
 *  times while browsing isn't necessarily one that's actually gotten used in a video. */
export function getMostUsedByProjectsTrackIds(): number[] {
  const rows = getDb()
    .prepare(
      `SELECT track_id, COUNT(*) as project_count
       FROM project_tracks
       GROUP BY track_id
       ORDER BY project_count DESC
       LIMIT ?`
    )
    .all(MOST_USED_LIMIT) as { track_id: number }[]
  return rows.map((r) => r.track_id)
}
