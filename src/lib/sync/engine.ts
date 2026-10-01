import type { TaskRepository } from '../core/repo';
import type { Service, SyncBatch } from '../core/types';

/** Re-fetch this much before the last successful sync to catch late-arriving updates. */
export const SYNC_OVERLAP_MS = 10 * 60 * 1000;
export const SYNC_INTERVAL_MS = 30 * 60 * 1000;

export interface ConnectorContext {
  now: Date;
  /** Cursor stored after the previous successful sync; null on first run (bootstrap). */
  cursor: string | null;
  lastSuccessAt: string | null;
}

/**
 * One account of one service. Phase 2/3 add real Asana, Google and Slack
 * connectors; they only need to turn API responses into a SyncBatch.
 */
export interface Connector {
  service: Exclude<Service, 'local'>;
  account: string;
  fetch(ctx: ConnectorContext): Promise<SyncBatch>;
}

export interface SyncReport {
  service: Service;
  account: string;
  ok: boolean;
  error?: string;
}

/**
 * Sync every connector independently. A failing source keeps its previous data
 * (we simply don't touch it) and records the error so the UI can show it as stale.
 */
export async function runSync(repo: TaskRepository, connectors: Connector[], now = new Date()): Promise<SyncReport[]> {
  const status = await repo.getSyncStatus();
  const reports: SyncReport[] = [];
  for (const c of connectors) {
    const prev = status.find((s) => s.service === c.service && s.account === c.account);
    try {
      const batch = await c.fetch({ now, cursor: prev ? await repo.getCursor(c.service, c.account) : null, lastSuccessAt: prev?.lastSuccessAt ?? null });
      await repo.applySync(c.service, c.account, batch, now);
      await repo.recordSyncOutcome(c.service, c.account, now, { ok: true, cursor: batch.cursor ?? null });
      reports.push({ service: c.service, account: c.account, ok: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await repo.recordSyncOutcome(c.service, c.account, now, { ok: false, error });
      reports.push({ service: c.service, account: c.account, ok: false, error });
    }
  }
  return reports;
}
