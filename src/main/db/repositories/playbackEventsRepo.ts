import { getDb } from '../database'

const VIEW_LIMIT = 100

export function getRecentlyPlayedTrackIds(): number[] {
  const rows = getDb()
    .prepare(
      `SELECT track_id, MAX(played_at) as last_played
       FROM playback_events
       WHERE event_type = 'played'
       GROUP BY track_id
       ORDER BY last_played DESC
       LIMIT ?`
    )
    .all(VIEW_LIMIT) as { track_id: number }[]
  return rows.map((r) => r.track_id)
}
