import { getDb } from '../database'

export function logPlaybackEvent(trackId: number, eventType: string): void {
  getDb()
    .prepare('INSERT INTO playback_events (track_id, played_at, event_type, context) VALUES (?, ?, ?, NULL)')
    .run(trackId, Date.now(), eventType)
}
