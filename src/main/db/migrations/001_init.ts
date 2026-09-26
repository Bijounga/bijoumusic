export const sql = `
CREATE TABLE library_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_root_id INTEGER NOT NULL REFERENCES library_roots(id),
  content_hash TEXT NOT NULL,
  current_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  extension TEXT NOT NULL,
  duration_seconds REAL,
  file_size_bytes INTEGER NOT NULL,
  file_mtime INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  is_missing INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tracks_content_hash ON tracks(content_hash);
CREATE INDEX idx_tracks_library_root ON tracks(library_root_id);
CREATE INDEX idx_tracks_folder_path ON tracks(folder_path);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE track_tags (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
);

CREATE INDEX idx_track_tags_tag ON track_tags(tag_id);

CREATE TABLE aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_aliases_track ON aliases(track_id);

CREATE TABLE track_ratings (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  favorite_level INTEGER,
  energy_level INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playback_state (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  position_seconds REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE playback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  context TEXT
);

CREATE INDEX idx_playback_events_track ON playback_events(track_id);
CREATE INDEX idx_playback_events_played_at ON playback_events(played_at);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  order_index INTEGER,
  note TEXT,
  UNIQUE(project_id, track_id)
);

CREATE INDEX idx_project_tracks_project ON project_tracks(project_id);
CREATE INDEX idx_project_tracks_track ON project_tracks(track_id);
`
