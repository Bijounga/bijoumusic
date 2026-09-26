export const sql = `
CREATE TABLE tag_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

ALTER TABLE tags ADD COLUMN group_id INTEGER REFERENCES tag_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_tags_group ON tags(group_id);
`
