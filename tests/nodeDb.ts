import { createRequire } from 'node:module';
import type { Db, SqlValue } from '../src/lib/db/db';

// node:sqlite is newer than some bundler builtin lists; require it at runtime.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export function openNodeDb(path = ':memory:'): Db & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
    },
    async select<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    close: () => db.close(),
  };
}
