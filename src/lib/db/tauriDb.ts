import Database from '@tauri-apps/plugin-sql';
import type { Db, SqlValue } from './db';

export async function openTauriDb(): Promise<Db> {
  // Resolves to the app's data directory, e.g. %APPDATA%\<identifier>\assistant.db on Windows.
  const db = await Database.load('sqlite:assistant.db');
  return {
    async execute(sql: string, params: SqlValue[] = []) {
      const r = await db.execute(sql, params);
      return { lastInsertId: Number(r.lastInsertId ?? 0), rowsAffected: r.rowsAffected };
    },
    select: <T>(sql: string, params: SqlValue[] = []) => db.select<T[]>(sql, params),
  };
}
