// NULL = tempo not worked out yet; 0 = worked out, but the song has no steady beat
// (or is too short to have one, like a sound effect).
export const sql = `
ALTER TABLE tracks ADD COLUMN bpm REAL;
`
