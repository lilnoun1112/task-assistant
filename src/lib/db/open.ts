import type { Db } from './db';
import { migrate } from './migrations';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openDb(): Promise<Db> {
  const db = isTauri() ? await (await import('./tauriDb')).openTauriDb() : await (await import('./browserDb')).openBrowserDb();
  await migrate(db);
  return db;
}
