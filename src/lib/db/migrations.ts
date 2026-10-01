import type { Db } from './db';

/**
 * Append-only. Never edit a migration that has shipped; add a new one.
 * Source records (what services say) and tasks (what the user decided) live in
 * separate tables so a refresh can rewrite the former without touching the latter.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE source_records (
    id               INTEGER PRIMARY KEY,
    service          TEXT NOT NULL,
    account          TEXT NOT NULL,
    source_id        TEXT NOT NULL,
    thread_id        TEXT,
    url              TEXT,
    kind             TEXT NOT NULL,
    title            TEXT NOT NULL,
    excerpt          TEXT,
    due_at           TEXT,
    starts_at        TEXT,
    ends_at          TEXT,
    sender           TEXT,
    context          TEXT,
    source_timestamp TEXT,
    first_seen_at    TEXT NOT NULL,
    last_seen_at     TEXT NOT NULL,
    fingerprint      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active',
    UNIQUE (service, account, source_id)
  );

  CREATE TABLE tasks (
    id                INTEGER PRIMARY KEY,
    origin            TEXT NOT NULL,            -- source | suggestion | personal
    review_state      TEXT,                     -- pending | accepted | rejected (suggestions only)
    title_override    TEXT,                     -- NULL = show the source title
    notes             TEXT NOT NULL DEFAULT '',
    due_override_set  INTEGER NOT NULL DEFAULT 0,
    due_override      TEXT,
    priority          INTEGER NOT NULL DEFAULT 0,
    completed_at      TEXT,
    dismissed_at      TEXT,
    snoozed_until     TEXT,
    source_changed_at TEXT,                     -- set when the source changed meaningfully
    action            TEXT,
    reason            TEXT,
    owner_confidence  TEXT,
    suggested_due     TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE task_sources (
    task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, record_id)
  );
  CREATE INDEX task_sources_record ON task_sources(record_id);

  CREATE TABLE subtasks (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sync_state (
    service         TEXT NOT NULL,
    account         TEXT NOT NULL,
    cursor          TEXT,
    last_success_at TEXT,
    last_attempt_at TEXT,
    last_error      TEXT,
    PRIMARY KEY (service, account)
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

/** Split on `;` at line ends. Fine for our own DDL (no triggers / string literals with `;`). */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate(db: Db): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const rows = await db.select<{ version: number }>('SELECT version FROM schema_version');
  let version = rows[0]?.version ?? 0;
  if (rows.length === 0) await db.execute('INSERT INTO schema_version (version) VALUES (0)');
  for (; version < MIGRATIONS.length; version++) {
    for (const stmt of statements(MIGRATIONS[version])) await db.execute(stmt);
    await db.execute('UPDATE schema_version SET version = ?', [version + 1]);
  }
}
