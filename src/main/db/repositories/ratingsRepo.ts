import { getDb } from '../database'

export interface TrackRatingRow {
  track_id: number
  favorite_level: number | null
  energy_level: number | null
  updated_at: number
}

export function listAllRatings(): TrackRatingRow[] {
  return getDb().prepare('SELECT * FROM track_ratings').all() as TrackRatingRow[]
}

function upsert(trackId: number, patch: { favorite_level?: number | null; energy_level?: number | null }): void {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM track_ratings WHERE track_id = ?').get(trackId) as
    | TrackRatingRow
    | undefined
  const favoriteLevel = 'favorite_level' in patch ? patch.favorite_level! : (existing?.favorite_level ?? null)
  const energyLevel = 'energy_level' in patch ? patch.energy_level! : (existing?.energy_level ?? null)
  db.prepare(
    `INSERT INTO track_ratings (track_id, favorite_level, energy_level, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET favorite_level = excluded.favorite_level, energy_level = excluded.energy_level, updated_at = excluded.updated_at`
  ).run(trackId, favoriteLevel, energyLevel, Date.now())
}

export function setFavoriteLevel(trackId: number, level: number | null): void {
  upsert(trackId, { favorite_level: level })
}

export function setEnergyLevel(trackId: number, level: number | null): void {
  upsert(trackId, { energy_level: level })
}
