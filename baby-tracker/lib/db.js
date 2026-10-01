import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const EVENT_TYPES = ['sleep', 'feed', 'diaper', 'growth', 'pump', 'medical', 'solid', 'milestone'];

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  family_id INTEGER NOT NULL REFERENCES families(id),
  units TEXT NOT NULL DEFAULT 'imperial',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_by INTEGER REFERENCES users(id),
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (${EVENT_TYPES.map((t) => `'${t}'`).join(', ')})),
  start_at TEXT NOT NULL,
  end_at TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_key TEXT
);

CREATE INDEX IF NOT EXISTS events_child_start ON events (child_id, start_at DESC);
CREATE INDEX IF NOT EXISTS events_child_updated ON events (child_id, updated_at);
`;

// Additive migrations for databases created by earlier versions.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  // Where an imported entry came from (e.g. "nara:<activity key>"), so re-imports skip it.
  if (!cols.includes('source_key')) db.exec('ALTER TABLE events ADD COLUMN source_key TEXT');

  // SQLite can't alter a CHECK constraint, so widen the allowed event types by rebuilding the table.
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'").get();
  if (!EVENT_TYPES.every((t) => sql.includes(`'${t}'`))) {
    db.exec('PRAGMA foreign_keys = OFF');
    transaction(db, () => {
      db.exec(sql.replace(/CREATE TABLE (IF NOT EXISTS )?events/, 'CREATE TABLE events_new')
        .replace(/CHECK \(type IN \([^)]*\)\)/, `CHECK (type IN (${EVENT_TYPES.map((t) => `'${t}'`).join(', ')}))`));
      db.exec(`INSERT INTO events_new (id, child_id, type, start_at, end_at, data, created_by, created_at, updated_at, source_key)
               SELECT id, child_id, type, start_at, end_at, data, created_by, created_at, updated_at, source_key FROM events`);
      db.exec('DROP TABLE events');
      db.exec('ALTER TABLE events_new RENAME TO events');
      db.exec('CREATE INDEX IF NOT EXISTS events_child_start ON events (child_id, start_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS events_child_updated ON events (child_id, updated_at)');
    });
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS events_child_source ON events (child_id, source_key) WHERE source_key IS NOT NULL');
}

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
