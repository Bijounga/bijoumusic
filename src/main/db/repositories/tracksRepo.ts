import { getDb } from '../database'

export interface TrackRow {
  id: number
  library_root_id: number
  content_hash: string
  current_path: string
  filename: string
  folder_path: string
  extension: string
  duration_seconds: number | null
  file_size_bytes: number
  file_mtime: number
  added_at: number
  last_seen_at: number
  is_missing: number
  preview_start_seconds: number | null
  preview_end_seconds: number | null
  loudness_rms: number | null
}

export function listTracks(): TrackRow[] {
  return getDb().prepare('SELECT * FROM tracks WHERE is_missing = 0 ORDER BY folder_path, filename').all() as TrackRow[]
}

export function findTrackByPath(path: string): TrackRow | undefined {
  return getDb().prepare('SELECT * FROM tracks WHERE current_path = ?').get(path) as TrackRow | undefined
}

/** Looser than findTrackByPath — matches on folder + filename rather than the
 *  exact full path string. Used right after a download, where the path came
 *  from yt-dlp's own stdout rather than this scanner's own directory walk, and
 *  the two aren't guaranteed to format the same absolute path identically. */
export function findTrackByFolderAndFilename(
  libraryRootId: number,
  folderPath: string,
  filename: string
): TrackRow | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM tracks WHERE library_root_id = ? AND folder_path = ? AND filename = ? ORDER BY added_at DESC LIMIT 1'
    )
    .get(libraryRootId, folderPath, filename) as TrackRow | undefined
}

export function findTrackById(id: number): TrackRow | undefined {
  return getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined
}

export function findTracksByHash(hash: string): TrackRow[] {
  return getDb().prepare('SELECT * FROM tracks WHERE content_hash = ?').all(hash) as TrackRow[]
}

/** Groups of tracks sharing a content hash, both still present on disk — the same
 *  audio scanned from two different files rather than a move/rename. */
export function findDuplicateGroups(): TrackRow[][] {
  const hashes = getDb()
    .prepare(
      'SELECT content_hash FROM tracks WHERE is_missing = 0 GROUP BY content_hash HAVING COUNT(*) > 1'
    )
    .all() as { content_hash: string }[]
  return hashes.map((h) => findTracksByHash(h.content_hash).filter((t) => t.is_missing === 0))
}

export interface NewTrack {
  library_root_id: number
  content_hash: string
  current_path: string
  filename: string
  folder_path: string
  extension: string
  duration_seconds: number | null
  file_size_bytes: number
  file_mtime: number
}

export function insertTrack(track: NewTrack): number {
  const now = Date.now()
  const result = getDb()
    .prepare(
      `INSERT INTO tracks
        (library_root_id, content_hash, current_path, filename, folder_path, extension,
         duration_seconds, file_size_bytes, file_mtime, added_at, last_seen_at, is_missing)
       VALUES (@library_root_id, @content_hash, @current_path, @filename, @folder_path, @extension,
         @duration_seconds, @file_size_bytes, @file_mtime, @added_at, @last_seen_at, 0)`
    )
    .run({ ...track, added_at: now, last_seen_at: now })
  return Number(result.lastInsertRowid)
}

export function touchTrackSeen(id: number): void {
  getDb().prepare('UPDATE tracks SET last_seen_at = ?, is_missing = 0 WHERE id = ?').run(Date.now(), id)
}

export function updateTrackContent(
  id: number,
  contentHash: string,
  fileSizeBytes: number,
  fileMtime: number
): void {
  getDb()
    .prepare(
      'UPDATE tracks SET content_hash = ?, file_size_bytes = ?, file_mtime = ?, last_seen_at = ?, is_missing = 0 WHERE id = ?'
    )
    .run(contentHash, fileSizeBytes, fileMtime, Date.now(), id)
}

export function updateTrackDuration(id: number, durationSeconds: number): void {
  getDb().prepare('UPDATE tracks SET duration_seconds = ? WHERE id = ?').run(durationSeconds, id)
}

export function updateTrackLoudness(id: number, loudnessRms: number): void {
  getDb().prepare('UPDATE tracks SET loudness_rms = ? WHERE id = ?').run(loudnessRms, id)
}

export function updateTrackPreviewRange(id: number, startSeconds: number | null, endSeconds: number | null): void {
  getDb()
    .prepare('UPDATE tracks SET preview_start_seconds = ?, preview_end_seconds = ? WHERE id = ?')
    .run(startSeconds, endSeconds, id)
}

export function moveTrack(id: number, newPath: string, folderPath: string, filename: string): void {
  getDb()
    .prepare(
      'UPDATE tracks SET current_path = ?, folder_path = ?, filename = ?, last_seen_at = ?, is_missing = 0 WHERE id = ?'
    )
    .run(newPath, folderPath, filename, Date.now(), id)
}

export function markTrackMissing(id: number): void {
  getDb().prepare('UPDATE tracks SET is_missing = 1 WHERE id = ?').run(id)
}

export function markMissingExcept(libraryRootId: number, seenIds: number[]): void {
  const db = getDb()
  const placeholders = seenIds.length > 0 ? seenIds.map(() => '?').join(',') : 'NULL'
  db.prepare(
    `UPDATE tracks SET is_missing = 1 WHERE library_root_id = ? AND id NOT IN (${placeholders})`
  ).run(libraryRootId, ...seenIds)
}

/** Same as markMissingExcept, but scoped to one folder (and its subfolders) rather
 *  than the whole root — a folder-only rescan must never touch is_missing for
 *  tracks outside the folder it actually walked, or everything else in the
 *  library would falsely get marked missing. */
export function markMissingExceptInFolder(libraryRootId: number, folderPath: string, seenIds: number[]): void {
  const db = getDb()
  const placeholders = seenIds.length > 0 ? seenIds.map(() => '?').join(',') : 'NULL'
  db.prepare(
    `UPDATE tracks SET is_missing = 1
     WHERE library_root_id = ?
       AND (folder_path = ? OR folder_path LIKE ?)
       AND id NOT IN (${placeholders})`
  ).run(libraryRootId, folderPath, `${folderPath}\\%`, ...seenIds)
}
