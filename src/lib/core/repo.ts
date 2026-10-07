import type { Db, SqlValue } from '../db/db';
import type {
  ExtractorId,
  IncomingRecord,
  OwnerConfidence,
  Origin,
  RecordKind,
  ReviewState,
  Service,
  SourceRecord,
  Subtask,
  SyncBatch,
  SyncStatus,
  TaskEdit,
  TaskView,
} from './types';

/**
 * Only fields whose change should be treated as a "clear change" go into the
 * fingerprint. A changed fingerprint flags the task and may reopen it if the
 * user had completed or dismissed it; anything else is refreshed silently.
 */
export function fingerprint(r: Pick<IncomingRecord, 'title' | 'dueAt' | 'startsAt' | 'endsAt'>): string {
  const input = [r.title.trim().replace(/\s+/g, ' '), r.dueAt ?? '', r.startsAt ?? '', r.endsAt ?? ''].join('␟');
  // FNV-1a, 32-bit. Collision resistance is irrelevant here; we only compare against the previous value.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Services whose new records become suggestions that need review instead of tasks. */
const REVIEWED_SERVICES: Service[] = ['gmail', 'slack'];

export interface SyncResult {
  added: number;
  updated: number;
  changed: number;
  unavailable: number;
}

interface TaskRow {
  id: number;
  origin: Origin;
  review_state: ReviewState | null;
  title_override: string | null;
  notes: string;
  due_override_set: number;
  due_override: string | null;
  priority: number;
  completed_at: string | null;
  dismissed_at: string | null;
  snoozed_until: string | null;
  source_changed_at: string | null;
  action: string | null;
  reason: string | null;
  owner_confidence: OwnerConfidence | null;
  suggested_due: string | null;
  evidence: string | null;
  extracted_by: ExtractorId | null;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: number;
  service: Service;
  account: string;
  source_id: string;
  thread_id: string | null;
  url: string | null;
  kind: RecordKind;
  title: string;
  excerpt: string | null;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sender: string | null;
  context: string | null;
  source_timestamp: string | null;
  first_seen_at: string;
  last_seen_at: string;
  fingerprint: string;
  status: 'active' | 'unavailable';
}

function toRecord(r: RecordRow): SourceRecord {
  return {
    id: r.id,
    service: r.service,
    account: r.account,
    sourceId: r.source_id,
    threadId: r.thread_id,
    url: r.url,
    kind: r.kind,
    title: r.title,
    excerpt: r.excerpt,
    dueAt: r.due_at,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    sender: r.sender,
    context: r.context,
    sourceTimestamp: r.source_timestamp,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    fingerprint: r.fingerprint,
    status: r.status,
  };
}

export class TaskRepository {
  constructor(private db: Db) {}

  // ---------------------------------------------------------------- sync

  /**
   * Merge one connector batch. Rules:
   *  - Source fields are always overwritten; local fields (title override, notes,
   *    due override, priority, subtasks, completion, snooze, dismissal) never are.
   *  - Same fingerprint: nothing about the task changes.
   *  - Changed fingerprint: task gets `source_changed_at`; if the user had completed
   *    or dismissed it, it is reopened so the change is noticed. Rejected suggestions
   *    stay rejected.
   *  - Missing from a snapshot / listed as removed: record becomes `unavailable`,
   *    the task stays until the user resolves it.
   *
   * Every step is idempotent, so a sync interrupted halfway converges on the next run
   * (the cursor is only advanced by the caller after this returns).
   */
  async applySync(service: Service, account: string, batch: SyncBatch, now: Date): Promise<SyncResult> {
    const ts = now.toISOString();
    const result: SyncResult = { added: 0, updated: 0, changed: 0, unavailable: 0 };
    const seen = new Set<string>();

    for (const rec of batch.records) {
      if (seen.has(rec.sourceId)) continue; // dedupe within the batch
      seen.add(rec.sourceId);
      const fp = fingerprint(rec);
      const [existing] = await this.db.select<RecordRow>(
        'SELECT * FROM source_records WHERE service = ? AND account = ? AND source_id = ?',
        [service, account, rec.sourceId],
      );

      const fields: SqlValue[] = [
        rec.threadId ?? null,
        rec.url ?? null,
        rec.kind,
        rec.title,
        rec.excerpt ?? null,
        rec.dueAt ?? null,
        rec.startsAt ?? null,
        rec.endsAt ?? null,
        rec.sender ?? null,
        rec.context ?? null,
        rec.sourceTimestamp ?? null,
      ];

      if (!existing) {
        const { lastInsertId } = await this.db.execute(
          `INSERT INTO source_records (thread_id, url, kind, title, excerpt, due_at, starts_at, ends_at, sender, context,
             source_timestamp, service, account, source_id, first_seen_at, last_seen_at, fingerprint, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [...fields, service, account, rec.sourceId, ts, ts, fp],
        );
        if (await this.createTaskForRecord(lastInsertId, service, rec, ts)) result.added++;
        continue;
      }

      await this.db.execute(
        `UPDATE source_records SET thread_id = ?, url = ?, kind = ?, title = ?, excerpt = ?, due_at = ?, starts_at = ?,
           ends_at = ?, sender = ?, context = ?, source_timestamp = ?, last_seen_at = ?, fingerprint = ?, status = 'active'
         WHERE id = ?`,
        [...fields, ts, fp, existing.id],
      );
      result.updated++;

      const linked = await this.db.select<{ task_id: number }>('SELECT task_id FROM task_sources WHERE record_id = ?', [
        existing.id,
      ]);
      if (linked.length === 0) {
        // e.g. a message first judged routine, re-read with more context and now a request
        if (rec.suggestion && (await this.createTaskForRecord(existing.id, service, rec, ts))) result.added++;
        continue;
      }

      if (existing.fingerprint !== fp) {
        result.changed++;
        for (const { task_id } of linked) {
          await this.db.execute(
            `UPDATE tasks SET
               source_changed_at = ?,
               completed_at = CASE WHEN review_state = 'rejected' THEN completed_at ELSE NULL END,
               dismissed_at = CASE WHEN review_state = 'rejected' THEN dismissed_at ELSE NULL END,
               updated_at = ?
             WHERE id = ?`,
            [ts, ts, task_id],
          );
        }
      }
    }

    // Mark vanished originals.
    let gone: RecordRow[] = [];
    if (batch.mode === 'snapshot') {
      const active = await this.db.select<RecordRow>(
        `SELECT * FROM source_records WHERE service = ? AND account = ? AND status = 'active'`,
        [service, account],
      );
      gone = active.filter((r) => !seen.has(r.source_id));
    } else if (batch.removedSourceIds?.length) {
      for (const sid of batch.removedSourceIds) {
        const rows = await this.db.select<RecordRow>(
          `SELECT * FROM source_records WHERE service = ? AND account = ? AND source_id = ? AND status = 'active'`,
          [service, account, sid],
        );
        gone.push(...rows);
      }
    }
    for (const r of gone) {
      await this.db.execute(`UPDATE source_records SET status = 'unavailable' WHERE id = ?`, [r.id]);
      result.unavailable++;
    }
    return result;
  }

  private async createTaskForRecord(recordId: number, service: Service, rec: IncomingRecord, ts: string): Promise<boolean> {
    let taskId: number;
    if (REVIEWED_SERVICES.includes(service)) {
      // Routine chat / FYI mail: keep the record (thread context) but no task.
      if (!rec.suggestion) return false;
      const s = rec.suggestion;
      ({ lastInsertId: taskId } = await this.db.execute(
        `INSERT INTO tasks (origin, review_state, action, reason, owner_confidence, suggested_due, evidence, extracted_by,
           created_at, updated_at)
         VALUES ('suggestion', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.action, s.reason, s.ownerConfidence, s.dueAt ?? null, s.evidence ?? null, s.extractedBy ?? 'source', ts, ts],
      ));
    } else {
      ({ lastInsertId: taskId } = await this.db.execute(
        `INSERT INTO tasks (origin, created_at, updated_at) VALUES ('source', ?, ?)`,
        [ts, ts],
      ));
    }
    await this.db.execute('INSERT INTO task_sources (task_id, record_id) VALUES (?, ?)', [taskId, recordId]);
    return true;
  }

  // ---------------------------------------------------------------- read

  async listTasks(): Promise<TaskView[]> {
    const tasks = await this.db.select<TaskRow>('SELECT * FROM tasks ORDER BY id');
    const links = await this.db.select<RecordRow & { task_id: number }>(
      `SELECT ts.task_id, r.* FROM task_sources ts JOIN source_records r ON r.id = ts.record_id ORDER BY r.id`,
    );
    const subs = await this.db.select<{ id: number; task_id: number; title: string; done: number; position: number }>(
      'SELECT * FROM subtasks ORDER BY position, id',
    );

    const recordsByTask = new Map<number, SourceRecord[]>();
    for (const l of links) {
      const list = recordsByTask.get(l.task_id) ?? [];
      list.push(toRecord(l));
      recordsByTask.set(l.task_id, list);
    }
    const subsByTask = new Map<number, Subtask[]>();
    for (const s of subs) {
      const list = subsByTask.get(s.task_id) ?? [];
      list.push({ id: s.id, taskId: s.task_id, title: s.title, done: !!s.done, position: s.position });
      subsByTask.set(s.task_id, list);
    }

    return tasks.map((t) => {
      const records = recordsByTask.get(t.id) ?? [];
      const primary = records[0] ?? null;
      const sourceTitle = t.origin === 'suggestion' ? t.action : (primary?.title ?? null);
      const sourceDue = t.origin === 'suggestion' ? t.suggested_due : (primary?.dueAt ?? null);
      return {
        id: t.id,
        origin: t.origin,
        kind: primary?.kind ?? 'personal',
        reviewState: t.review_state,
        title: t.title_override ?? sourceTitle ?? '',
        sourceTitle,
        titleEdited: t.title_override !== null,
        notes: t.notes,
        excerpt: primary?.excerpt ?? null,
        dueAt: t.due_override_set ? t.due_override : sourceDue,
        dueEdited: !!t.due_override_set,
        startsAt: primary?.startsAt ?? null,
        endsAt: primary?.endsAt ?? null,
        priority: t.priority,
        completedAt: t.completed_at,
        dismissedAt: t.dismissed_at,
        snoozedUntil: t.snoozed_until,
        sourceChangedAt: t.source_changed_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        action: t.action,
        reason: t.reason,
        ownerConfidence: t.owner_confidence,
        evidence: t.evidence,
        extractedBy: t.extracted_by,
        sender: primary?.sender ?? null,
        context: primary?.context ?? null,
        sources: records.map((r) => ({ service: r.service, url: r.url, status: r.status, sourceId: r.sourceId })),
        subtasks: subsByTask.get(t.id) ?? [],
      };
    });
  }

  /** True once a record has been stored, so extraction runs only on genuinely new messages. */
  async hasRecord(service: Service, account: string, sourceId: string): Promise<boolean> {
    const rows = await this.db.select('SELECT 1 FROM source_records WHERE service = ? AND account = ? AND source_id = ?', [
      service,
      account,
      sourceId,
    ]);
    return rows.length > 0;
  }

  async getTask(id: number): Promise<TaskView | undefined> {
    return (await this.listTasks()).find((t) => t.id === id);
  }

  // ---------------------------------------------------------------- write

  async addPersonalTask(title: string, now: Date, dueAt: string | null = null): Promise<number> {
    const ts = now.toISOString();
    const { lastInsertId } = await this.db.execute(
      `INSERT INTO tasks (origin, title_override, due_override_set, due_override, created_at, updated_at)
       VALUES ('personal', ?, 1, ?, ?, ?)`,
      [title.trim(), dueAt, ts, ts],
    );
    return lastInsertId;
  }

  async editTask(id: number, edit: TaskEdit, now: Date): Promise<void> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (edit.title !== undefined) {
      const t = edit.title?.trim() || null;
      // Editing back to the exact source title drops the override so future source renames show up.
      const [cur] = await this.db.select<{ origin: Origin }>('SELECT origin FROM tasks WHERE id = ?', [id]);
      const view = cur && cur.origin !== 'personal' ? await this.getTask(id) : undefined;
      sets.push('title_override = ?');
      params.push(view && t === view.sourceTitle ? null : t);
    }
    if (edit.notes !== undefined) {
      sets.push('notes = ?');
      params.push(edit.notes);
    }
    if (edit.revertDue) {
      sets.push('due_override_set = 0', 'due_override = NULL');
    } else if (edit.dueAt !== undefined) {
      sets.push('due_override_set = 1', 'due_override = ?');
      params.push(edit.dueAt);
    }
    if (edit.priority !== undefined) {
      sets.push('priority = ?');
      params.push(Math.max(0, Math.min(3, Math.round(edit.priority))));
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    params.push(now.toISOString(), id);
    await this.db.execute(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  private async setFields(id: number, sql: string, params: SqlValue[], now: Date) {
    await this.db.execute(`UPDATE tasks SET ${sql}, updated_at = ? WHERE id = ?`, [...params, now.toISOString(), id]);
  }

  setCompleted(id: number, done: boolean, now: Date) {
    return this.setFields(id, 'completed_at = ?, source_changed_at = NULL', [done ? now.toISOString() : null], now);
  }

  dismiss(id: number, now: Date) {
    return this.setFields(id, 'dismissed_at = ?, source_changed_at = NULL', [now.toISOString()], now);
  }

  /** Undo dismiss / snooze / completion / rejection. */
  restore(id: number, now: Date) {
    return this.setFields(
      id,
      `dismissed_at = NULL, snoozed_until = NULL, completed_at = NULL,
       review_state = CASE WHEN review_state = 'rejected' THEN 'pending' ELSE review_state END`,
      [],
      now,
    );
  }

  snooze(id: number, until: Date, now: Date) {
    return this.setFields(id, 'snoozed_until = ?', [until.toISOString()], now);
  }

  acknowledgeChange(id: number, now: Date) {
    return this.setFields(id, 'source_changed_at = NULL', [], now);
  }

  acceptSuggestion(id: number, now: Date) {
    return this.setFields(id, `review_state = 'accepted'`, [], now);
  }

  rejectSuggestion(id: number, now: Date) {
    return this.setFields(id, `review_state = 'rejected', dismissed_at = ?`, [now.toISOString()], now);
  }

  /** Permanently remove a personal task, or a task whose original no longer exists. */
  async deleteTask(id: number): Promise<void> {
    await this.db.execute('DELETE FROM subtasks WHERE task_id = ?', [id]);
    await this.db.execute('DELETE FROM task_sources WHERE task_id = ?', [id]);
    await this.db.execute('DELETE FROM tasks WHERE id = ?', [id]);
  }

  async addSubtask(taskId: number, title: string, now: Date): Promise<number> {
    const [{ next }] = await this.db.select<{ next: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM subtasks WHERE task_id = ?',
      [taskId],
    );
    const { lastInsertId } = await this.db.execute('INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)', [
      taskId,
      title.trim(),
      next,
    ]);
    await this.db.execute('UPDATE tasks SET updated_at = ? WHERE id = ?', [now.toISOString(), taskId]);
    return lastInsertId;
  }

  async updateSubtask(id: number, patch: { title?: string; done?: boolean }): Promise<void> {
    if (patch.title !== undefined) await this.db.execute('UPDATE subtasks SET title = ? WHERE id = ?', [patch.title, id]);
    if (patch.done !== undefined) await this.db.execute('UPDATE subtasks SET done = ? WHERE id = ?', [patch.done ? 1 : 0, id]);
  }

  async deleteSubtask(id: number): Promise<void> {
    await this.db.execute('DELETE FROM subtasks WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------------- sync bookkeeping

  async getSyncStatus(): Promise<SyncStatus[]> {
    const rows = await this.db.select<{
      service: Service;
      account: string;
      last_success_at: string | null;
      last_attempt_at: string | null;
      last_error: string | null;
    }>('SELECT * FROM sync_state ORDER BY service');
    return rows.map((r) => ({
      service: r.service,
      account: r.account,
      lastSuccessAt: r.last_success_at,
      lastAttemptAt: r.last_attempt_at,
      lastError: r.last_error,
    }));
  }

  async getCursor(service: Service, account: string): Promise<string | null> {
    const [row] = await this.db.select<{ cursor: string | null }>(
      'SELECT cursor FROM sync_state WHERE service = ? AND account = ?',
      [service, account],
    );
    return row?.cursor ?? null;
  }

  async recordSyncOutcome(
    service: Service,
    account: string,
    now: Date,
    outcome: { ok: true; cursor: string | null } | { ok: false; error: string },
  ): Promise<void> {
    const ts = now.toISOString();
    await this.db.execute(
      `INSERT INTO sync_state (service, account, last_attempt_at) VALUES (?, ?, ?)
       ON CONFLICT (service, account) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
      [service, account, ts],
    );
    if (outcome.ok) {
      await this.db.execute(
        'UPDATE sync_state SET cursor = ?, last_success_at = ?, last_error = NULL WHERE service = ? AND account = ?',
        [outcome.cursor, ts, service, account],
      );
    } else {
      await this.db.execute('UPDATE sync_state SET last_error = ? WHERE service = ? AND account = ?', [
        outcome.error,
        service,
        account,
      ]);
    }
  }

  // ---------------------------------------------------------------- settings / data

  async getSetting(key: string): Promise<string | null> {
    const [row] = await this.db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  /** "Clear data": wipes every stored message excerpt, task and sync cursor. */
  async clearAll(): Promise<void> {
    for (const table of ['subtasks', 'task_sources', 'tasks', 'source_records', 'sync_state', 'settings']) {
      await this.db.execute(`DELETE FROM ${table}`);
    }
  }
}
