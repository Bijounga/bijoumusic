import { readdir, stat } from 'fs/promises'
import { basename, dirname, join, relative, resolve } from 'path'
import { getDb, getDbPath } from './db/database'
import { findLibraryRootByPath, listLibraryRoots } from './db/repositories/libraryRootsRepo'
import type { MoveRootReport, MoveRootResult } from '@shared/types'

// "Move library folder": re-points one library folder at a new location (e.g. the
// copy in Google Drive) WITHOUT losing anything attached to its songs. Every song
// keeps its database row — and so its tags, ratings, aliases, bookmarks and
// project memberships — and just gets its path switched to the same relative file
// in the new folder. Songs that aren't found there (or whose size differs) are
// left alone and marked missing, so nothing is ever silently re-linked to the
// wrong file.
//
// Matching is done against what is really on disk in the new folder (an index of
// it), not by gluing the stored names onto the new path: the same accented letter
// can be stored precomposed (Google Drive, macOS) or as letter + accent mark
// (decomposed), and a stored name in the "wrong" form would otherwise be saved
// verbatim, differ from what the next scan lists, and be treated as a new song.

interface TrackMoveRow {
  id: number
  folder_path: string
  filename: string
  file_size_bytes: number
}

interface IndexedFile {
  fullPath: string
  folderPath: string
  filename: string
  size: number
  mtimeMs: number
}

interface Match {
  id: number
  file: IndexedFile
}

const STAT_BATCH = 64

/** Same file regardless of accent encoding or letter case. */
const keyFor = (relativePath: string): string => relativePath.normalize('NFC').toLowerCase()

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Every file under `root`, keyed by its normalized relative path. */
async function indexFolder(root: string): Promise<Map<string, IndexedFile>> {
  const index = new Map<string, IndexedFile>()
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const files: string[] = []
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) files.push(full)
    }
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      await Promise.all(
        files.slice(i, i + STAT_BATCH).map(async (full) => {
          try {
            const s = await stat(full)
            const rel = relative(root, full)
            index.set(keyFor(rel), {
              fullPath: full,
              folderPath: relative(root, dirname(full)),
              filename: basename(full),
              size: s.size,
              mtimeMs: s.mtimeMs
            })
          } catch {
            // Unreadable file: treated as not there.
          }
        })
      )
    }
  }
  await walk(root)
  return index
}

async function analyze(rootId: number, pickedPath: string): Promise<{ report: MoveRootReport; matches: Match[] }> {
  const root = listLibraryRoots().find((r) => r.id === rootId)
  const newPath = resolve(pickedPath)
  const empty = (error: string, oldPath = root?.path ?? ''): { report: MoveRootReport; matches: Match[] } => ({
    report: { oldPath, newPath, total: 0, found: 0, missing: 0, missingSamples: [], error },
    matches: []
  })

  if (!root) return empty('That library folder no longer exists.')
  if (!(await isDirectory(newPath))) return empty("That folder doesn't exist.")
  if (newPath.toLowerCase() === root.path.toLowerCase()) return empty('That is already this library folder.')
  const clash = findLibraryRootByPath(newPath)
  if (clash) return empty('That folder is already another library folder in BijouMusic.')

  const rows = getDb()
    .prepare('SELECT id, folder_path, filename, file_size_bytes FROM tracks WHERE library_root_id = ?')
    .all(rootId) as TrackMoveRow[]

  const index = await indexFolder(newPath)
  const matches: Match[] = []
  const missingSamples: string[] = []
  for (const row of rows) {
    const file = index.get(keyFor(join(row.folder_path, row.filename)))
    // Same relative path AND same size: cheap, and a different file with the same
    // name is very unlikely to also match on exact byte size.
    if (file && file.size === row.file_size_bytes) matches.push({ id: row.id, file })
    else if (missingSamples.length < 8) missingSamples.push(join(row.folder_path, row.filename))
  }

  const report: MoveRootReport = {
    oldPath: root.path,
    newPath,
    total: rows.length,
    found: matches.length,
    missing: rows.length - matches.length,
    missingSamples
  }
  if (matches.length === 0 && rows.length > 0) {
    const inner = join(newPath, basename(root.path))
    if (await isDirectory(inner)) report.suggestedPath = inner
    report.error = "None of this library's songs were found in that folder."
  }
  return { report, matches }
}

export async function analyzeMoveRoot(rootId: number, pickedPath: string): Promise<MoveRootReport> {
  return (await analyze(rootId, pickedPath)).report
}

export async function applyMoveRoot(rootId: number, pickedPath: string): Promise<MoveRootResult> {
  const { report, matches } = await analyze(rootId, pickedPath)
  if (report.error) throw new Error(report.error)
  const root = listLibraryRoots().find((r) => r.id === rootId)
  if (!root) throw new Error('That library folder no longer exists.')

  const db = getDb()
  // A safety copy of the whole database, made first, so the move can always be
  // undone by putting this file back (next to library.sqlite3, same folder).
  const backupPath = join(dirname(getDbPath()), `library-backup-before-move-${Date.now()}.sqlite3`)
  await db.backup(backupPath)

  const foundIds = new Set(matches.map((m) => m.id))
  const allIds = (db.prepare('SELECT id FROM tracks WHERE library_root_id = ?').all(rootId) as { id: number }[]).map((r) => r.id)

  let moved = 0
  let skippedConflicts = 0
  const now = Date.now()

  db.transaction(() => {
    // Keep a custom name; follow the folder's name only if it was just the default.
    const newName = root.name === basename(root.path) ? basename(report.newPath) : root.name
    db.prepare('UPDATE library_roots SET path = ?, name = ? WHERE id = ?').run(report.newPath, newName, rootId)

    // folder_path and filename are rewritten to the names as they really exist in
    // the new folder, so they equal exactly what the next scan will list.
    const setPath = db.prepare(
      'UPDATE tracks SET current_path = ?, folder_path = ?, filename = ?, file_mtime = ?, is_missing = 0, last_seen_at = ? WHERE id = ?'
    )
    const pathTaken = db.prepare('SELECT id FROM tracks WHERE current_path = ? AND id != ?')
    for (const { id, file } of matches) {
      // current_path is UNIQUE; if some other row already owns that exact path,
      // leave this one alone rather than fail the whole move.
      if (pathTaken.get(file.fullPath, id)) {
        skippedConflicts++
        continue
      }
      setPath.run(file.fullPath, file.folderPath, file.filename, file.mtimeMs, now, id)
      moved++
    }
    const markMissing = db.prepare('UPDATE tracks SET is_missing = 1 WHERE id = ?')
    for (const id of allIds) if (!foundIds.has(id)) markMissing.run(id)
  })()

  return { moved, missing: allIds.length - foundIds.size, skippedConflicts, backupPath }
}
