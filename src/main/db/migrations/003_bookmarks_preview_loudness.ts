export const sql = `
CREATE TABLE track_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_track_bookmarks_track ON track_bookmarks(track_id);

ALTER TABLE tracks ADD COLUMN preview_start_seconds REAL;
ALTER TABLE tracks ADD COLUMN preview_end_seconds REAL;
ALTER TABLE tracks ADD COLUMN loudness_rms REAL;
`
