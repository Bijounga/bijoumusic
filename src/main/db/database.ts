import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { migrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initDatabase() first')
  }
  return db
}

export function isDatabaseOpen(): boolean {
  return db !== null
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'library.sqlite3')
}

// A handful of confirmed-real cases (antivirus real-time scanning intercepting a
// freshly-written exe's I/O, and possibly a stray second process momentarily
// touching the file before this one's single-instance lock wins) have produced a
// "database disk image is malformed" error on open or on the very first read
// afterward — even though the file is provably fine (PRAGMA integrity_check
// passes) once reopened a moment later. These retries exist for that specific,
// observed, self-correcting failure — not to paper over a genuine schema bug,
// which won't carry one of these codes and will still surface immediately.
const TRANSIENT_SQLITE_ERROR_CODE_PREFIXES = ['SQLITE_CORRUPT', 'SQLITE_IOERR', 'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_NOTADB']
const OPEN_RETRY_ATTEMPTS = 4
const OPEN_RETRY_DELAY_MS = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientSqliteError(err: unknown): boolean {
  if (!(err instanceof Database.SqliteError)) return false
  return TRANSIENT_SQLITE_ERROR_CODE_PREFIXES.some((prefix) => err.code.startsWith(prefix))
}

function openAndPrepareDatabase(dbPath: string): Database.Database {
  const database = new Database(dbPath)
  // Deliberately NOT WAL mode. WAL's benefit is concurrent readers during a write,
  // which doesn't matter here — this app only ever has one process/connection open
  // (enforced by the single-instance lock in index.ts) — and WAL's shared-memory
  // -shm file is a known trip point for antivirus real-time scanning on Windows,
  // occasionally producing spurious "database disk image is malformed" errors that
  // have nothing to do with real corruption. The default rollback-journal mode
  // avoids that mechanism entirely.
  database.pragma('journal_mode = TRUNCATE')
  database.pragma('foreign_keys = ON')

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const appliedVersions = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: number }).version)
  )

  const applyMigration = database.transaction((version: number, sql: string) => {
    database.exec(sql)
    database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now())
  })

  for (const migration of migrations.sort((a, b) => a.version - b.version)) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration.version, migration.sql)
    }
  }

  // A real read-back, not just opening the file — the transient failure observed
  // in practice has shown up on the first query after open, not on open itself.
  database.prepare('SELECT COUNT(*) FROM schema_migrations').get()

  return database
}

export async function initDatabase(): Promise<Database.Database> {
  const dbPath = join(app.getPath('userData'), 'library.sqlite3')

  let lastError: unknown
  for (let attempt = 1; attempt <= OPEN_RETRY_ATTEMPTS; attempt++) {
    try {
      db = openAndPrepareDatabase(dbPath)
      return db
    } catch (err) {
      lastError = err
      db = null
      const transient = isTransientSqliteError(err)
      console.error(
        `[database] open attempt ${attempt}/${OPEN_RETRY_ATTEMPTS} failed${transient ? ' (transient — retrying)' : ' (not transient — giving up)'}:`,
        err
      )
      if (!transient) break
      if (attempt < OPEN_RETRY_ATTEMPTS) await delay(OPEN_RETRY_DELAY_MS)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

// Confirmed via direct testing (2026-09-17): the long-lived singleton connection
// can end up reading stale data relative to what's actually on disk — a *brand
// new* connection to the exact same file, opened moments later from the exact
// same process, reads correctly every time, so this isn't a wrong-path or
// corruption issue, just this one connection's own view going stale somehow.
// The real mechanism was never pinned down, but a full close+reopen reliably
// fixes it (that's exactly what the working "fresh connection" test did), so
// this gives the app a way to self-heal rather than staying stuck. Wired to
// window focus in index.ts, since that's the natural moment external changes
// (another process, a direct DB edit) would need picking up.
export async function refreshDatabaseConnection(): Promise<void> {
  closeDatabase()
  await initDatabase()
}
