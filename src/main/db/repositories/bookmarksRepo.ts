import { getDb } from '../database'

export interface BookmarkRow {
  id: number
  track_id: number
  position_seconds: number
  label: string | null
  created_at: number
}

export function listAllBookmarks(): BookmarkRow[] {
  return getDb().prepare('SELECT * FROM track_bookmarks ORDER BY position_seconds').all() as BookmarkRow[]
}

export function addBookmark(trackId: number, positionSeconds: number, label: string | null): BookmarkRow {
  const now = Date.now()
  const result = getDb()
    .prepare('INSERT INTO track_bookmarks (track_id, position_seconds, label, created_at) VALUES (?, ?, ?, ?)')
    .run(trackId, positionSeconds, label, now)
  return {
    id: Number(result.lastInsertRowid),
    track_id: trackId,
    position_seconds: positionSeconds,
    label,
    created_at: now
  }
}

export function deleteBookmark(id: number): void {
  getDb().prepare('DELETE FROM track_bookmarks WHERE id = ?').run(id)
}
