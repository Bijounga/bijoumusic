import { getDb } from '../database'

export interface AliasRow {
  id: number
  track_id: number
  alias_text: string
  created_at: number
}

export function listAllAliases(): AliasRow[] {
  return getDb().prepare('SELECT * FROM aliases ORDER BY created_at').all() as AliasRow[]
}

export function addAlias(trackId: number, aliasText: string): AliasRow {
  const result = getDb()
    .prepare('INSERT INTO aliases (track_id, alias_text, created_at) VALUES (?, ?, ?)')
    .run(trackId, aliasText, Date.now())
  return getDb().prepare('SELECT * FROM aliases WHERE id = ?').get(result.lastInsertRowid) as AliasRow
}

export function deleteAlias(id: number): void {
  getDb().prepare('DELETE FROM aliases WHERE id = ?').run(id)
}
