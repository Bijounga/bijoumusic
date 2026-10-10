import { getDb } from '../db/database'
import { hashOfKey, kindOf, nameKey, type Entries } from './syncMerge'

// The database half of sync: read this machine's hand-made data into the flat
// key/value form syncMerge works on, and write a merged result back. Key layout:
//   g|<group>                -> group name
//   t|<tag>                  -> {n: name, g: group name | null, c: color | null}
//   p|<project>              -> {n: name, a: archived 0/1}
//   tt|<hash>|<tag>          -> '1'                 (a song has a tag)
//   al|<hash>|<alias text>   -> '1'
//   bm|<hash>|<milliseconds> -> label ('' for none)
//   rt|<hash>                -> {f: favorite, e: energy, u: time it was set}
//   pt|<project>|<hash>      -> note ('' for none)  (a song is in a project)
// <hash> is the song's content hash, so it means the same song on every machine.

export interface LocalSnapshot {
  tracks: Set<string>
  entries: Entries
}

interface TagValue {
  n: string
  g: string | null
  c: string | null
}

export function buildLocalSnapshot(): LocalSnapshot {
  const db = getDb()
  const entries: Entries = {}

  const hashById = new Map<number, string>()
  const tracks = new Set<string>()
  for (const row of db.prepare('SELECT id, content_hash FROM tracks').all() as { id: number; content_hash: string }[]) {
    hashById.set(row.id, row.content_hash)
    tracks.add(row.content_hash)
  }

  for (const g of db.prepare('SELECT name FROM tag_groups').all() as { name: string }[]) {
    entries[`g|${nameKey(g.name)}`] = g.name
  }

  const tagKeyById = new Map<number, string>()
  const tagRows = db
    .prepare('SELECT t.id, t.name, t.color, g.name AS group_name FROM tags t LEFT JOIN tag_groups g ON g.id = t.group_id')
    .all() as { id: number; name: string; color: string | null; group_name: string | null }[]
  for (const t of tagRows) {
    const key = nameKey(t.name)
    tagKeyById.set(t.id, key)
    const value: TagValue = { n: t.name, g: t.group_name, c: t.color }
    entries[`t|${key}`] = JSON.stringify(value)
  }

  const projectKeyById = new Map<number, string>()
  for (const p of db.prepare('SELECT id, name, archived FROM projects').all() as { id: number; name: string; archived: number }[]) {
    const key = nameKey(p.name)
    // Projects aren't forced unique by name; the first one with a name speaks for it.
    if (entries[`p|${key}`] !== undefined) continue
    projectKeyById.set(p.id, key)
    entries[`p|${key}`] = JSON.stringify({ n: p.name, a: p.archived ? 1 : 0 })
  }

  for (const r of db.prepare('SELECT track_id, tag_id FROM track_tags').all() as { track_id: number; tag_id: number }[]) {
    const hash = hashById.get(r.track_id)
    const tag = tagKeyById.get(r.tag_id)
    if (hash && tag) entries[`tt|${hash}|${tag}`] = '1'
  }

  for (const r of db.prepare('SELECT track_id, alias_text FROM aliases').all() as { track_id: number; alias_text: string }[]) {
    const hash = hashById.get(r.track_id)
    if (hash) entries[`al|${hash}|${r.alias_text}`] = '1'
  }

  for (const r of db
    .prepare('SELECT track_id, position_seconds, label FROM track_bookmarks')
    .all() as { track_id: number; position_seconds: number; label: string | null }[]) {
    const hash = hashById.get(r.track_id)
    if (hash) entries[`bm|${hash}|${Math.round(r.position_seconds * 1000)}`] = r.label ?? ''
  }

  // A song can exist twice (a genuine second copy with the same content); the most
  // recently set rating speaks for the content.
  const newestRating = new Map<string, { f: number | null; e: number | null; u: number }>()
  for (const r of db
    .prepare('SELECT track_id, favorite_level, energy_level, updated_at FROM track_ratings')
    .all() as { track_id: number; favorite_level: number | null; energy_level: number | null; updated_at: number }[]) {
    const hash = hashById.get(r.track_id)
    if (!hash) continue
    const have = newestRating.get(hash)
    if (!have || r.updated_at > have.u) newestRating.set(hash, { f: r.favorite_level, e: r.energy_level, u: r.updated_at })
  }
  for (const [hash, v] of newestRating) entries[`rt|${hash}`] = JSON.stringify({ f: v.f, e: v.e, u: v.u })

  for (const r of db
    .prepare('SELECT project_id, track_id, note FROM project_tracks')
    .all() as { project_id: number; track_id: number; note: string | null }[]) {
    const hash = hashById.get(r.track_id)
    const project = projectKeyById.get(r.project_id)
    if (hash && project) entries[`pt|${project}|${hash}`] = r.note ?? ''
  }

  return { tracks, entries }
}

/** Writes the difference between what's here and the merged result into the
 *  database, all in one transaction. Returns how many facts changed. */
export function applyMerged(local: Entries, merged: Entries): number {
  const db = getDb()

  const changedKeys: string[] = []
  for (const key of Object.keys(merged)) if (local[key] !== merged[key]) changedKeys.push(key)
  for (const key of Object.keys(local)) if (merged[key] === undefined) changedKeys.push(key)
  if (changedKeys.length === 0) return 0

  const idsByHash = new Map<string, number[]>()
  for (const row of db.prepare('SELECT id, content_hash FROM tracks').all() as { id: number; content_hash: string }[]) {
    const list = idsByHash.get(row.content_hash)
    if (list) list.push(row.id)
    else idsByHash.set(row.content_hash, [row.id])
  }
  const idsFor = (hash: string): number[] => idsByHash.get(hash) ?? []

  db.transaction(() => {
    const groupIdByKey = new Map<string, number>()
    for (const g of db.prepare('SELECT id, name FROM tag_groups').all() as { id: number; name: string }[]) {
      groupIdByKey.set(nameKey(g.name), g.id)
    }
    const tagIdByKey = new Map<string, number>()
    const tagGroupByKey = new Map<string, number | null>()
    for (const t of db.prepare('SELECT id, name, group_id FROM tags').all() as { id: number; name: string; group_id: number | null }[]) {
      tagIdByKey.set(nameKey(t.name), t.id)
      tagGroupByKey.set(nameKey(t.name), t.group_id)
    }
    const projectIdByKey = new Map<string, number>()
    for (const p of db.prepare('SELECT id, name FROM projects ORDER BY id').all() as { id: number; name: string }[]) {
      const key = nameKey(p.name)
      if (!projectIdByKey.has(key)) projectIdByKey.set(key, p.id)
    }

    const nextTagOrder = (): number =>
      (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tags').get() as { n: number }).n
    const ensureGroup = (name: string): number => {
      const key = nameKey(name)
      const have = groupIdByKey.get(key)
      if (have !== undefined) return have
      const id = Number(db.prepare('INSERT INTO tag_groups (name, created_at) VALUES (?, ?)').run(name, Date.now()).lastInsertRowid)
      groupIdByKey.set(key, id)
      return id
    }

    const entityKeys = changedKeys.filter((k) => hashOfKey(k) === null)
    const factKeys = changedKeys.filter((k) => hashOfKey(k) !== null)

    // 1. Groups, tags and projects that exist on the other machine.
    for (const key of entityKeys) {
      const value = merged[key]
      if (value === undefined) continue
      const kind = kindOf(key)
      if (kind === 'g') ensureGroup(value)
    }
    for (const key of entityKeys) {
      const value = merged[key]
      if (value === undefined) continue
      const kind = kindOf(key)
      const entityKey = key.slice(kind.length + 1)
      if (kind === 't') {
        const tag = JSON.parse(value) as TagValue
        const groupId = tag.g ? ensureGroup(tag.g) : null
        const existing = tagIdByKey.get(entityKey)
        if (existing === undefined) {
          const id = Number(
            db
              .prepare('INSERT INTO tags (name, group_id, color, created_at, sort_order) VALUES (?, ?, ?, ?, ?)')
              .run(tag.n, groupId, tag.c, Date.now(), nextTagOrder()).lastInsertRowid
          )
          tagIdByKey.set(entityKey, id)
        } else {
          if (tagGroupByKey.get(entityKey) !== groupId) {
            db.prepare('UPDATE tags SET group_id = ?, sort_order = ? WHERE id = ?').run(groupId, nextTagOrder(), existing)
          }
          // Name too, so a change that is only capitalisation converges.
          db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(tag.n, tag.c, existing)
        }
      } else if (kind === 'p') {
        const project = JSON.parse(value) as { n: string; a: number }
        const existing = projectIdByKey.get(entityKey)
        if (existing === undefined) {
          const now = Date.now()
          const id = Number(
            db.prepare('INSERT INTO projects (name, created_at, updated_at, archived) VALUES (?, ?, ?, ?)').run(project.n, now, now, project.a).lastInsertRowid
          )
          projectIdByKey.set(entityKey, id)
        } else {
          db.prepare('UPDATE projects SET archived = ? WHERE id = ?').run(project.a, existing)
        }
      }
    }

    // 2. Facts about songs: added / changed / removed.
    const addTag = db.prepare('INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)')
    const dropTag = db.prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?')
    const hasAlias = db.prepare('SELECT 1 FROM aliases WHERE track_id = ? AND alias_text = ?')
    const addAliasRow = db.prepare('INSERT INTO aliases (track_id, alias_text, created_at) VALUES (?, ?, ?)')
    const dropAlias = db.prepare('DELETE FROM aliases WHERE track_id = ? AND alias_text = ?')
    const hasBookmark = db.prepare('SELECT 1 FROM track_bookmarks WHERE track_id = ? AND CAST(ROUND(position_seconds * 1000) AS INTEGER) = ?')
    const addBookmarkRow = db.prepare('INSERT INTO track_bookmarks (track_id, position_seconds, label, created_at) VALUES (?, ?, ?, ?)')
    const dropBookmark = db.prepare('DELETE FROM track_bookmarks WHERE track_id = ? AND CAST(ROUND(position_seconds * 1000) AS INTEGER) = ?')
    const setRating = db.prepare(
      `INSERT INTO track_ratings (track_id, favorite_level, energy_level, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET favorite_level = excluded.favorite_level, energy_level = excluded.energy_level, updated_at = excluded.updated_at`
    )
    const dropRating = db.prepare('DELETE FROM track_ratings WHERE track_id = ?')
    const setMembership = db.prepare(
      `INSERT INTO project_tracks (project_id, track_id, added_at, note) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, track_id) DO UPDATE SET note = excluded.note`
    )
    const dropMembership = db.prepare('DELETE FROM project_tracks WHERE project_id = ? AND track_id = ?')

    for (const key of factKeys) {
      const value = merged[key]
      const kind = kindOf(key)
      const hash = hashOfKey(key)!
      const ids = idsFor(hash)
      if (ids.length === 0) continue
      const rest = key.slice(kind.length + 1)

      if (kind === 'tt') {
        const tagId = tagIdByKey.get(rest.slice(rest.indexOf('|') + 1))
        if (tagId === undefined) continue
        for (const id of ids) (value === undefined ? dropTag : addTag).run(id, tagId)
      } else if (kind === 'al') {
        const text = rest.slice(rest.indexOf('|') + 1)
        for (const id of ids) {
          if (value === undefined) dropAlias.run(id, text)
          else if (!hasAlias.get(id, text)) addAliasRow.run(id, text, Date.now())
        }
      } else if (kind === 'bm') {
        const ms = Number(rest.slice(rest.indexOf('|') + 1))
        for (const id of ids) {
          if (value === undefined) dropBookmark.run(id, ms)
          else if (!hasBookmark.get(id, ms)) addBookmarkRow.run(id, ms / 1000, value === '' ? null : value, Date.now())
        }
      } else if (kind === 'rt') {
        if (value === undefined) {
          for (const id of ids) dropRating.run(id)
        } else {
          const r = JSON.parse(value) as { f: number | null; e: number | null; u: number }
          for (const id of ids) setRating.run(id, r.f, r.e, r.u)
        }
      } else if (kind === 'pt') {
        const projectId = projectIdByKey.get(rest.slice(0, rest.lastIndexOf('|')))
        if (projectId === undefined) continue
        for (const id of ids) {
          if (value === undefined) dropMembership.run(projectId, id)
          else setMembership.run(projectId, id, Date.now(), value === '' ? null : value)
        }
      }
    }

    // 3. Things the other machine deleted (after their assignments are gone).
    for (const key of entityKeys) {
      if (merged[key] !== undefined) continue
      const kind = kindOf(key)
      const entityKey = key.slice(kind.length + 1)
      if (kind === 't') {
        const id = tagIdByKey.get(entityKey)
        if (id !== undefined) db.prepare('DELETE FROM tags WHERE id = ?').run(id)
      } else if (kind === 'p') {
        const id = projectIdByKey.get(entityKey)
        if (id !== undefined) db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      } else if (kind === 'g') {
        const id = groupIdByKey.get(entityKey)
        if (id !== undefined) db.prepare('DELETE FROM tag_groups WHERE id = ?').run(id)
      }
    }
  })()

  return changedKeys.length
}
