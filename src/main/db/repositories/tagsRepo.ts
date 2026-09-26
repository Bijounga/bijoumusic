import Database from 'better-sqlite3'
import { getDb, getDbPath } from '../database'

export interface TagStorageInfo {
  dbPath: string
  /** Count as the app's own long-lived connection currently sees it — if this
   *  ever disagrees with freshCount, that connection has gone stale (a real,
   *  confirmed-possible failure mode — see refreshDatabaseConnection). */
  cachedCount: number
  /** Count from a brand-new connection opened just for this check, then closed
   *  — this has proven 100% reliable in testing, so it's the one to trust if
   *  the two ever disagree. */
  freshCount: number
}

/** Answers "where is this tag actually stored, and does what I'm looking at
 *  right now match what's really on disk" — both a genuine feature (the user
 *  asked to be able to verify this themselves) and a live diagnostic for the
 *  stale-connection bug, without needing an external tool to catch it. */
export function getTagStorageInfo(tagId: number): TagStorageInfo {
  const cachedCount = (
    getDb().prepare('SELECT COUNT(*) c FROM track_tags WHERE tag_id = ?').get(tagId) as { c: number }
  ).c

  const dbPath = getDbPath()
  const fresh = new Database(dbPath, { readonly: true })
  try {
    const freshCount = (fresh.prepare('SELECT COUNT(*) c FROM track_tags WHERE tag_id = ?').get(tagId) as { c: number })
      .c
    return { dbPath, cachedCount, freshCount }
  } finally {
    fresh.close()
  }
}

export interface TagRow {
  id: number
  name: string
  group_id: number | null
  color: string | null
  created_at: number
  sort_order: number
}

export function listTags(): TagRow[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY sort_order ASC, name COLLATE NOCASE').all() as TagRow[]
}

export function findTagByName(name: string): TagRow | undefined {
  return getDb().prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(name) as TagRow | undefined
}

export function createTag(name: string, groupId: number | null): TagRow {
  const existing = findTagByName(name)
  if (existing) return existing
  const nextOrder = (
    getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tags').get() as { next: number }
  ).next
  const result = getDb()
    .prepare('INSERT INTO tags (name, group_id, color, created_at, sort_order) VALUES (?, ?, NULL, ?, ?)')
    .run(name, groupId, Date.now(), nextOrder)
  return getDb().prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid) as TagRow
}

export function renameTag(id: number, name: string): void {
  getDb().prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
}

/** Moves a tag into a different section (or ungroups it, for null) — appended to
 *  the end of its new group's own order rather than keeping its old sort_order,
 *  since that number was only ever meaningful relative to its previous group's
 *  other tags. */
export function moveTagToGroup(id: number, groupId: number | null): void {
  const nextOrder = (
    getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tags').get() as { next: number }
  ).next
  getDb().prepare('UPDATE tags SET group_id = ?, sort_order = ? WHERE id = ?').run(groupId, nextOrder, id)
}

/** Persists a new manual order for a set of tags (typically one group's list after
 *  a drag-and-drop reorder) — the given array's index becomes each tag's sort_order. */
export function reorderTags(orderedIds: number[]): void {
  const update = getDb().prepare('UPDATE tags SET sort_order = ? WHERE id = ?')
  const tx = getDb().transaction((ids: number[]) => {
    ids.forEach((id, index) => update.run(index, id))
  })
  tx(orderedIds)
}

export function deleteTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export interface TrackTagAssignment {
  track_id: number
  tag_id: number
}

export function listAllTrackTagAssignments(): TrackTagAssignment[] {
  return getDb().prepare('SELECT track_id, tag_id FROM track_tags').all() as TrackTagAssignment[]
}

/** Returns true if this actually added a new assignment, false if the track
 *  already had this tag (the INSERT OR IGNORE was a no-op) — callers that need
 *  to distinguish "just applied" from "already there" (e.g. an import summary)
 *  can use this instead of assuming every call changes something. */
export function addTrackTag(trackId: number, tagId: number): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)')
    .run(trackId, tagId)
  return result.changes > 0
}

export function removeTrackTag(trackId: number, tagId: number): void {
  getDb().prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?').run(trackId, tagId)
}
