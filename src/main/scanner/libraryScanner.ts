import { readdir, stat, access } from 'fs/promises'
import { join, relative, extname, basename, dirname } from 'path'
import { getDb } from '../db/database'
import { computePartialHash } from './fileIdentity'
import {
  findTrackByPath,
  findTracksByHash,
  insertTrack,
  touchTrackSeen,
  moveTrack,
  updateTrackContent,
  markMissingExcept,
  markMissingExceptInFolder,
  type NewTrack
} from '../db/repositories/tracksRepo'
import { importExternalTags } from './externalTagsImporter'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg'])

export interface ScanProgress {
  scanned: number
  total: number
  currentFile: string
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
    } else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

type PendingWrite =
  | { kind: 'touch'; id: number }
  | { kind: 'update'; id: number; contentHash: string; size: number; mtime: number }
  | { kind: 'move'; id: number; filePath: string; folderPath: string; filename: string }
  | { kind: 'insert'; track: NewTrack }

export interface ScanOutcome {
  added: number
  moved: number
  updated: number
  unchanged: number
  missing: number
  externalTagsApplied: number
  externalTagsCreated: number
  /** Ids of tracks freshly inserted by this scan (not touched/updated/moved) —
   *  lets a caller that just dropped exactly one known-new file into a folder
   *  (e.g. right after a download) identify its resulting track without any
   *  string-matching against a path from an external source. That matters
   *  because a path round-tripped through a spawned process's stdout (as a
   *  downloader's reported output path is) isn't guaranteed to reproduce
   *  non-ASCII characters identically to how Node's own fs calls encode them —
   *  concretely, yt-dlp sanitizes ":"/"|" etc. in titles into Unicode fullwidth
   *  lookalikes, and that exact byte sequence didn't survive its trip through
   *  stdout, so a filename-string match against it silently found nothing. */
  insertedTrackIds: number[]
}

interface ScannedFiles {
  pending: PendingWrite[]
  added: number
  moved: number
  updated: number
  unchanged: number
}

/** The actual per-file identity/diff logic — shared between a full-root scan and
 *  a single-folder scan, which differ only in which files get walked and how the
 *  resulting "everything else is missing" pass is scoped. */
async function scanFiles(
  files: string[],
  rootPath: string,
  libraryRootId: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScannedFiles> {
  let added = 0
  let moved = 0
  let updated = 0
  let unchanged = 0

  // The file-system walk (stat, hashing) is unavoidably async and dominates wall
  // clock time regardless, but the actual database writes were each committing
  // individually — fine for a few hundred files, ruinous for a library that just
  // grew by several thousand small SFX clips (every insert was its own disk
  // commit). So writes are only *decided* here; they're collected and applied in
  // one transaction below instead of as they're found.
  const pending: PendingWrite[] = []

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]
    onProgress?.({ scanned: i + 1, total: files.length, currentFile: filePath })

    const stats = await stat(filePath)
    const folderPath = relative(rootPath, dirname(filePath))
    const filename = basename(filePath)
    const extension = extname(filePath).toLowerCase()

    // A row already owns this exact path — either it's unchanged, or its content
    // was edited in place. Either way we update that row rather than touching
    // current_path, so we never risk colliding with the path's own UNIQUE constraint.
    const existingByPath = findTrackByPath(filePath)
    if (existingByPath) {
      if (existingByPath.file_size_bytes === stats.size && existingByPath.file_mtime === stats.mtimeMs) {
        pending.push({ kind: 'touch', id: existingByPath.id })
        unchanged++
      } else {
        const contentHash = await computePartialHash(filePath, stats.size)
        pending.push({ kind: 'update', id: existingByPath.id, contentHash, size: stats.size, mtime: stats.mtimeMs })
        updated++
      }
      continue
    }

    // No row at this path yet — see whether this content is a known track that moved
    // here. A hash match alone isn't enough: if every row sharing this hash still has
    // its own path present on disk, this is a genuine second copy (the user keeps the
    // same track filed under two folders), not a move — it needs its own row rather
    // than stealing an existing one, or the earlier copy would silently disappear.
    // Checked against the real filesystem (not just this scan's own file list) so this
    // holds even when the two copies fall under different roots or separate scans.
    const contentHash = await computePartialHash(filePath, stats.size)
    const candidates = findTracksByHash(contentHash)
    let orphan: (typeof candidates)[number] | undefined
    for (const candidate of candidates) {
      if (!(await pathExists(candidate.current_path))) {
        orphan = candidate
        break
      }
    }

    if (orphan) {
      pending.push({ kind: 'move', id: orphan.id, filePath, folderPath, filename })
      moved++
      continue
    }

    pending.push({
      kind: 'insert',
      track: {
        library_root_id: libraryRootId,
        content_hash: contentHash,
        current_path: filePath,
        filename,
        folder_path: folderPath,
        extension,
        duration_seconds: null,
        file_size_bytes: stats.size,
        file_mtime: stats.mtimeMs
      }
    })
    added++
  }

  return { pending, added, moved, updated, unchanged }
}

interface CommitResult {
  /** Every track seen this scan (touched, updated, moved, or inserted). */
  ids: number[]
  /** Just the ones that are genuinely new rows. */
  insertedIds: number[]
}

/** Commits the writes scanFiles decided on — the caller applies whichever
 *  "everything else is missing" scope actually matches what it walked. */
function commitScannedFiles(pending: PendingWrite[]): CommitResult {
  return getDb().transaction((writes: PendingWrite[]) => {
    const ids: number[] = []
    const insertedIds: number[] = []
    for (const write of writes) {
      switch (write.kind) {
        case 'touch':
          touchTrackSeen(write.id)
          ids.push(write.id)
          break
        case 'update':
          updateTrackContent(write.id, write.contentHash, write.size, write.mtime)
          ids.push(write.id)
          break
        case 'move':
          moveTrack(write.id, write.filePath, write.folderPath, write.filename)
          ids.push(write.id)
          break
        case 'insert': {
          const id = insertTrack(write.track)
          ids.push(id)
          insertedIds.push(id)
          break
        }
      }
    }
    return { ids, insertedIds }
  })(pending)
}

function countMissing(libraryRootId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as c FROM tracks WHERE library_root_id = ? AND is_missing = 1')
    .get(libraryRootId) as { c: number }
  return row.c
}

export async function scanLibraryRoot(
  libraryRootId: number,
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanOutcome> {
  const files = await walk(rootPath)
  const scanned = await scanFiles(files, rootPath, libraryRootId, onProgress)
  const { ids, insertedIds } = commitScannedFiles(scanned.pending)
  markMissingExcept(libraryRootId, ids)

  // After the track rows exist (inserts above are committed), so a track newly
  // added by this very scan can still pick up its sidecar tags in the same pass
  // rather than needing a second scan.
  const externalTags = await importExternalTags(rootPath)

  return {
    added: scanned.added,
    moved: scanned.moved,
    updated: scanned.updated,
    unchanged: scanned.unchanged,
    missing: countMissing(libraryRootId),
    externalTagsApplied: externalTags.tagAssignmentsAdded,
    externalTagsCreated: externalTags.tagsCreated,
    insertedTrackIds: insertedIds
  }
}

/** Scans just one folder (and its subfolders) instead of the whole root — much
 *  cheaper when only one file changed, e.g. right after a single download, or
 *  a manual "rescan this folder" from the sidebar. relativePath === '' means
 *  "the root itself", which is just the full scan (walking the root already
 *  covers everything, and scoping is-missing to the whole root is correct). */
export async function scanFolder(
  libraryRootId: number,
  rootPath: string,
  relativePath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScanOutcome> {
  if (!relativePath) return scanLibraryRoot(libraryRootId, rootPath, onProgress)

  const targetDir = join(rootPath, relativePath)
  const files = await walk(targetDir)
  const scanned = await scanFiles(files, rootPath, libraryRootId, onProgress)
  const { ids, insertedIds } = commitScannedFiles(scanned.pending)
  markMissingExceptInFolder(libraryRootId, relativePath, ids)

  const externalTags = await importExternalTags(targetDir)

  return {
    added: scanned.added,
    moved: scanned.moved,
    updated: scanned.updated,
    unchanged: scanned.unchanged,
    missing: countMissing(libraryRootId),
    externalTagsApplied: externalTags.tagAssignmentsAdded,
    externalTagsCreated: externalTags.tagsCreated,
    insertedTrackIds: insertedIds
  }
}
