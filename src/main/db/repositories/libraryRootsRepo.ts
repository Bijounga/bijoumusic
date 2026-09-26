import { getDb } from '../database'

export interface LibraryRootRow {
  id: number
  path: string
  name: string
  created_at: number
}

export function listLibraryRoots(): LibraryRootRow[] {
  return getDb().prepare('SELECT * FROM library_roots ORDER BY created_at').all() as LibraryRootRow[]
}

export function findLibraryRootByPath(path: string): LibraryRootRow | undefined {
  return getDb().prepare('SELECT * FROM library_roots WHERE path = ?').get(path) as LibraryRootRow | undefined
}

export function insertLibraryRoot(path: string, name: string): LibraryRootRow {
  const result = getDb()
    .prepare('INSERT INTO library_roots (path, name, created_at) VALUES (?, ?, ?)')
    .run(path, name, Date.now())
  return findLibraryRootByPath(path) ?? {
    id: Number(result.lastInsertRowid),
    path,
    name,
    created_at: Date.now()
  }
}

export function getOrCreateLibraryRoot(path: string, name: string): LibraryRootRow {
  return findLibraryRootByPath(path) ?? insertLibraryRoot(path, name)
}
