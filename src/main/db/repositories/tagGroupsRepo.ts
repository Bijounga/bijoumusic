import { getDb } from '../database'

export interface TagGroupRow {
  id: number
  name: string
  created_at: number
}

export function listTagGroups(): TagGroupRow[] {
  return getDb().prepare('SELECT * FROM tag_groups ORDER BY name COLLATE NOCASE').all() as TagGroupRow[]
}

export function createTagGroup(name: string): TagGroupRow {
  const result = getDb().prepare('INSERT INTO tag_groups (name, created_at) VALUES (?, ?)').run(name, Date.now())
  return getDb().prepare('SELECT * FROM tag_groups WHERE id = ?').get(result.lastInsertRowid) as TagGroupRow
}

export function renameTagGroup(id: number, name: string): void {
  getDb().prepare('UPDATE tag_groups SET name = ? WHERE id = ?').run(name, id)
}

export function deleteTagGroup(id: number): void {
  // Tags in this group become ungrouped (ON DELETE SET NULL), not deleted — the
  // group is just an organizational label, the tags themselves stay useful.
  getDb().prepare('DELETE FROM tag_groups WHERE id = ?').run(id)
}
