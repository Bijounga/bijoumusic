import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { findTrackByPath } from '../db/repositories/tracksRepo'
import { findTagByName, createTag, addTrackTag } from '../db/repositories/tagsRepo'
import { listTagGroups, createTagGroup } from '../db/repositories/tagGroupsRepo'

const SIDECAR_FOLDER_NAME = '.ts'

// The exact vocabulary your friend's TagSpaces-based auto-tagger uses (given
// directly, 2026-09-07) — used only to slot a brand-new tag into a sensible
// group the first time it's seen. A tag title outside these lists still
// imports fine, it just lands ungrouped rather than guessing a category.
const MOOD_TAG_NAMES = new Set([
  'adventure',
  'awkward',
  'bombastic-heavy',
  'build-up',
  'chill',
  'epic',
  'goofy',
  'hopeful',
  'hype',
  'loss',
  'melancholic',
  'mysterious',
  'ominous',
  'serene',
  'tension',
  'victory'
])
const SOUND_TAG_NAMES = new Set([
  'ambient',
  'beachy',
  'childish',
  'chiptuney',
  'choir',
  'dreamy',
  'electronic',
  'fantasy',
  'folk',
  'funky',
  'jazzy',
  'medieval',
  'orchestral',
  'oriental',
  'rock-metal',
  'romantic',
  'trappy',
  'tribal',
  'vocals',
  'wintery',
  'weird'
])

interface SidecarTag {
  title?: unknown
}
interface SidecarFile {
  tags?: SidecarTag[]
}

export interface ExternalTagImportResult {
  filesRead: number
  tracksTagged: number
  tagAssignmentsAdded: number
  tagsCreated: number
}

async function findSidecarFolders(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    if (entry.name === SIDECAR_FOLDER_NAME) {
      out.push(full)
    } else {
      await findSidecarFolders(full, out)
    }
  }
  return out
}

// Resolved lazily (not at module load) since it queries the database, and reset
// per import run so a group created mid-run is picked up without re-querying.
let groupIdByLowercaseName: Map<string, number> | null = null

function getOrCreateGroupId(name: string): number {
  if (!groupIdByLowercaseName) {
    groupIdByLowercaseName = new Map(listTagGroups().map((g) => [g.name.toLowerCase(), g.id]))
  }
  const key = name.toLowerCase()
  const existing = groupIdByLowercaseName.get(key)
  if (existing !== undefined) return existing
  const created = createTagGroup(name)
  groupIdByLowercaseName.set(key, created.id)
  return created.id
}

function resolveGroupIdForNewTag(tagNameLower: string): number | null {
  if (MOOD_TAG_NAMES.has(tagNameLower)) return getOrCreateGroupId('Mood')
  if (SOUND_TAG_NAMES.has(tagNameLower)) return getOrCreateGroupId('Sound')
  return null
}

/** Scans rootPath for TagSpaces-style ".ts" sidecar folders — one per directory,
 *  each holding "<original filename>.json" per tagged file, exactly the format
 *  your friend's auto-tagger writes (confirmed against real sidecar files:
 *  {"tags":[{"title":"...","type":"sidecar"}],"appName":"TagSpaces"}) — and
 *  applies whatever tags it finds to the matching BijouMusic track, creating
 *  any tag that doesn't exist yet.
 *
 *  Runs as part of every regular library scan (see scanLibraryRoot), not as a
 *  separate action, so newly (re-)tagged files pick up their tags automatically
 *  on the next scan without anyone having to remember to run an import.
 *
 *  Matches by exact file path against tracks the scan already knows about —
 *  intentionally only tags files BijouMusic has itself indexed, so it can never
 *  create orphaned track_tags rows. A sidecar for a file BijouMusic hasn't seen
 *  yet (e.g. tagged before ever being scanned here) is simply skipped; it's
 *  picked up automatically on the next scan once the track itself exists. */
export async function importExternalTags(rootPath: string): Promise<ExternalTagImportResult> {
  groupIdByLowercaseName = null
  const result: ExternalTagImportResult = { filesRead: 0, tracksTagged: 0, tagAssignmentsAdded: 0, tagsCreated: 0 }

  const sidecarFolders = await findSidecarFolders(rootPath)

  for (const sidecarFolder of sidecarFolders) {
    const parentDir = dirname(sidecarFolder)

    let entries: string[]
    try {
      entries = await readdir(sidecarFolder)
    } catch {
      continue
    }
    const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'))

    for (const jsonFile of jsonFiles) {
      const originalFilename = jsonFile.slice(0, -'.json'.length)
      const track = findTrackByPath(join(parentDir, originalFilename))
      if (!track) continue

      let parsed: SidecarFile
      try {
        parsed = JSON.parse(await readFile(join(sidecarFolder, jsonFile), 'utf8'))
      } catch {
        continue
      }
      result.filesRead++

      const titles = (parsed.tags ?? [])
        .map((t) => t.title)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      if (titles.length === 0) continue

      let taggedThisTrack = false
      for (const title of titles) {
        let tag = findTagByName(title)
        if (!tag) {
          tag = createTag(title, resolveGroupIdForNewTag(title.toLowerCase()))
          result.tagsCreated++
        }
        if (addTrackTag(track.id, tag.id)) result.tagAssignmentsAdded++
        taggedThisTrack = true
      }
      if (taggedThisTrack) result.tracksTagged++
    }
  }

  return result
}
