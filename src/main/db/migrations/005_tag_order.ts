export const sql = `
ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE tags SET sort_order = id;
`
