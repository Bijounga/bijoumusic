const SETTINGS_PREFIX = 'bijoumusic:'

/** Reconciles this window's localStorage (origin-scoped — a fresh Vite dev port or
 *  the packaged app's file:// origin each start with none of it) against the
 *  shared settings table in the real database, which every window reads no matter
 *  how it was loaded. Must run — and be awaited — before any store reads
 *  localStorage at module-eval time, so callers import this ahead of anything that
 *  touches those keys (see main.tsx's deferred `import('./App')`).
 *
 *  Any bijoumusic: key already sitting in this origin's localStorage but missing
 *  from the DB is pushed up first — this is what carries real settings over the
 *  first time this code runs against an origin that still has them (e.g. an
 *  existing dev window after this shipped); every other window just pulls what's
 *  already there. */
export async function bootstrapSettings(): Promise<void> {
  const dbSettings = await window.api.settingsGetAll()

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(SETTINGS_PREFIX)) continue
    if (dbSettings[key] !== undefined) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    dbSettings[key] = value
    void window.api.settingsSet(key, value)
  }

  for (const [key, value] of Object.entries(dbSettings)) {
    localStorage.setItem(key, value)
  }
}

/** Write-through for every bijoumusic: setting — keeps localStorage (so this same
 *  origin's next load is instant and synchronous) and the shared DB (so every
 *  other window converges to it) in agreement. */
export function setSetting(key: string, value: string): void {
  localStorage.setItem(key, value)
  void window.api.settingsSet(key, value)
}
