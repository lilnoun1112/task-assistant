/**
 * Minimal async SQL surface shared by the three runtimes:
 *  - Tauri (tauri-plugin-sql, the real app)
 *  - browser preview (sql.js, for `npm run dev` without the desktop shell)
 *  - Node tests (node:sqlite)
 * Placeholders are positional `?`.
 */
export type SqlValue = string | number | null;

export interface Db {
  execute(sql: string, params?: SqlValue[]): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
}
