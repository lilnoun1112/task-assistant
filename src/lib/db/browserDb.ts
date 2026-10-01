import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { Db, SqlValue } from './db';

const KEY = 'desktop-assistant-preview-db';

/**
 * Browser-only preview (`npm run dev` outside Tauri): an in-memory SQLite
 * mirrored to localStorage so "restart" (reload) can be tested quickly.
 */
export async function openBrowserDb(): Promise<Db> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* storage blocked: run in-memory only */
  }
  const db = saved ? new SQL.Database(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0))) : new SQL.Database();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const bytes = db.export();
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try {
        localStorage.setItem(KEY, btoa(bin));
      } catch {
        /* ignore */
      }
    }, 100);
  };

  return {
    async execute(sql: string, params: SqlValue[] = []) {
      db.run(sql, params);
      const rowsAffected = db.getRowsModified();
      const [{ values }] = db.exec('SELECT last_insert_rowid()');
      persist();
      return { lastInsertId: Number(values[0][0]), rowsAffected };
    },
    async select<T>(sql: string, params: SqlValue[] = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
  };
}
