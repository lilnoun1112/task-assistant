import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { TaskRepository } from '../src/lib/core/repo';
import type { IncomingRecord, SyncBatch, TaskView } from '../src/lib/core/types';
import { bucketOf, buildSummary } from '../src/lib/core/views';
import { migrate } from '../src/lib/db/migrations';
import { runSync, type Connector } from '../src/lib/sync/engine';
import { sampleConnectors } from '../src/lib/sync/sample';
import { openNodeDb } from './nodeDb';

const NOW = new Date(2026, 9, 1, 9, 0); // Thu 1 Oct 2026, 09:00 local
const later = (mins: number) => new Date(NOW.getTime() + mins * 60000);

const asanaTask = (over: Partial<IncomingRecord> = {}): IncomingRecord => ({
  sourceId: 'A1',
  kind: 'task',
  title: 'Write brief',
  dueAt: '2026-10-02',
  url: 'https://app.asana.com/0/0/A1',
  ...over,
});
const snap = (...records: IncomingRecord[]): SyncBatch => ({ mode: 'snapshot', records });

let repo: TaskRepository;
beforeEach(async () => {
  const db = openNodeDb();
  await migrate(db);
  repo = new TaskRepository(db);
});

async function only(): Promise<TaskView> {
  const all = await repo.listTasks();
  expect(all).toHaveLength(1);
  return all[0];
}

describe('persistence', () => {
  it('keeps tasks and edits after the database is reopened', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'assistant-')), 'test.db');
    let db = openNodeDb(path);
    await migrate(db);
    let r = new TaskRepository(db);
    await r.applySync('asana', 'me', snap(asanaTask()), NOW);
    const [t] = await r.listTasks();
    await r.editTask(t.id, { title: 'Write the brief properly', priority: 3 }, NOW);
    const personal = await r.addPersonalTask('Buy milk', NOW);
    await r.addSubtask(personal, 'Oat', NOW);
    db.close();

    db = openNodeDb(path);
    await migrate(db); // must be a no-op on an up-to-date schema
    r = new TaskRepository(db);
    const tasks = await r.listTasks();
    expect(tasks.map((x) => x.title)).toEqual(['Write the brief properly', 'Buy milk']);
    expect(tasks[0].priority).toBe(3);
    expect(tasks[1].subtasks.map((s) => s.title)).toEqual(['Oat']);
    db.close();
  });
});

describe('refresh merging', () => {
  it('preserves local edits when the source refreshes, even if the source changes', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask()), NOW);
    const t = await only();
    await repo.editTask(t.id, { title: 'My title', notes: 'my notes', priority: 2, dueAt: '2026-10-05' }, NOW);
    await repo.addSubtask(t.id, 'step 1', NOW);

    await repo.applySync('asana', 'me', snap(asanaTask({ title: 'Renamed upstream', dueAt: '2026-10-03' })), later(30));
    const after = await only();
    expect(after).toMatchObject({ title: 'My title', notes: 'my notes', priority: 2, dueAt: '2026-10-05', sourceTitle: 'Renamed upstream' });
    expect(after.subtasks).toHaveLength(1);
    expect(after.sourceChangedAt).not.toBeNull();
  });

  it('follows source changes for fields the user has not edited', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask()), NOW);
    await repo.applySync('asana', 'me', snap(asanaTask({ title: 'New name', dueAt: '2026-10-09' })), later(30));
    expect(await only()).toMatchObject({ title: 'New name', dueAt: '2026-10-09', titleEdited: false });
  });

  it('does not resurrect completed or dismissed tasks when nothing meaningful changed', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask(), asanaTask({ sourceId: 'A2', title: 'Other' })), NOW);
    const [a, b] = await repo.listTasks();
    await repo.setCompleted(a.id, true, NOW);
    await repo.dismiss(b.id, NOW);
    // excerpt/url changes are not "clear changes"
    await repo.applySync('asana', 'me', snap(asanaTask({ excerpt: 'edited notes' }), asanaTask({ sourceId: 'A2', title: 'Other', url: 'x' })), later(30));
    const [a2, b2] = await repo.listTasks();
    expect(bucketOf(a2, NOW)).toBe('completed');
    expect(bucketOf(b2, NOW)).toBe('dismissed');
    expect(a2.excerpt).toBe('edited notes');
  });

  it('reopens a locally completed task when its deadline changes in the source, and flags it', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask()), NOW);
    const t = await only();
    await repo.setCompleted(t.id, true, NOW);
    await repo.applySync('asana', 'me', snap(asanaTask({ dueAt: '2026-10-08' })), later(30));
    const after = await only();
    expect(after.completedAt).toBeNull();
    expect(after.sourceChangedAt).not.toBeNull();
    await repo.acknowledgeChange(t.id, NOW);
    expect((await only()).sourceChangedAt).toBeNull();
  });

  it('marks originals missing from a snapshot as unavailable but keeps the task', async () => {
    await repo.applySync('gdoc', 'me', snap(asanaTask({ kind: 'checklist_item', sourceId: 'k1' })), NOW);
    const t = await only();
    await repo.editTask(t.id, { notes: 'keep me' }, NOW);
    await repo.applySync('gdoc', 'me', snap(), later(30));
    const after = await only();
    expect(after.sources[0].status).toBe('unavailable');
    expect(after.notes).toBe('keep me');
    // and it comes back cleanly if the original reappears
    await repo.applySync('gdoc', 'me', snap(asanaTask({ kind: 'checklist_item', sourceId: 'k1' })), later(60));
    expect((await only()).sources[0].status).toBe('active');
  });

  it('handles incremental removals', async () => {
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [msg('m1', true)] }, NOW);
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [], removedSourceIds: ['m1'] }, later(1));
    expect((await only()).sources[0].status).toBe('unavailable');
  });

  it('deduplicates by service + source id across and within syncs', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask(), asanaTask()), NOW);
    await repo.applySync('asana', 'me', snap(asanaTask()), later(30));
    await repo.applySync('asana', 'other-account', snap(asanaTask()), later(30));
    expect(await repo.listTasks()).toHaveLength(2); // same id in another account is a different item
  });
});

function msg(id: string, actionable: boolean, dueAt: string | null = null): IncomingRecord {
  return {
    sourceId: id,
    threadId: 't-' + id,
    kind: 'message',
    title: 'DM',
    sender: 'Priya',
    excerpt: actionable ? 'can you review my PR?' : 'lol',
    url: 'https://slack.com/x',
    suggestion: actionable ? { action: 'Review PR', reason: 'Direct request', ownerConfidence: 'me', dueAt } : null,
  };
}

describe('review queue', () => {
  it('puts actionable messages in review and ignores routine chat', async () => {
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [msg('m1', true), msg('m2', false)] }, NOW);
    const t = await only();
    expect(bucketOf(t, NOW)).toBe('review');
    expect(t).toMatchObject({ title: 'Review PR', reason: 'Direct request', ownerConfidence: 'me', dueAt: null, sender: 'Priya' });
  });

  it('never re-queues a rejected suggestion when the message is seen again', async () => {
    await repo.applySync('gmail', 'me', { mode: 'incremental', records: [msg('m1', true)] }, NOW);
    const t = await only();
    await repo.rejectSuggestion(t.id, NOW);
    await repo.applySync('gmail', 'me', { mode: 'incremental', records: [{ ...msg('m1', true), title: 'changed subject' }] }, later(30));
    expect(bucketOf(await only(), NOW)).toBe('dismissed');
  });

  it('accepting moves a suggestion into the main list', async () => {
    await repo.applySync('gmail', 'me', { mode: 'incremental', records: [msg('m1', true, '2026-10-01')] }, NOW);
    const t = await only();
    await repo.acceptSuggestion(t.id, NOW);
    expect(bucketOf(await only(), NOW)).toBe('today');
  });
});

describe('buckets and summary', () => {
  it('snoozed tasks disappear until the snooze ends', async () => {
    const id = await repo.addPersonalTask('Call bank', NOW, '2026-10-01');
    await repo.snooze(id, later(120), NOW);
    const t = await only();
    expect(bucketOf(t, NOW)).toBe('snoozed');
    expect(bucketOf(t, later(121))).toBe('today');
    await repo.restore(id, NOW);
    expect(bucketOf(await only(), NOW)).toBe('today');
  });

  it('summarises overdue, due today, meetings and unreviewed requests without a model', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask({ sourceId: 'o', dueAt: '2026-09-29' }), asanaTask({ sourceId: 't', dueAt: '2026-10-01' }), asanaTask({ sourceId: 'u', dueAt: '2026-10-20' })), NOW);
    await repo.applySync('calendar', 'me', snap({ sourceId: 'e1', kind: 'meeting', title: 'Sync', startsAt: later(60).toISOString(), endsAt: later(90).toISOString() }, { sourceId: 'e0', kind: 'meeting', title: 'Yesterday', startsAt: new Date(2026, 8, 30, 10).toISOString() }), NOW);
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [msg('m1', true)] }, NOW);
    const s = buildSummary(await repo.listTasks(), NOW);
    expect(s.overdue.map((t) => t.title)).toHaveLength(1);
    expect(s.dueToday).toHaveLength(1);
    expect(s.meetings.map((t) => t.title)).toEqual(['Sync']);
    expect(s.unreviewed).toHaveLength(1);
    expect(s.text).toBe('1 overdue · 1 due today · 1 meeting coming up · 1 request to review');
    const yesterday = (await repo.listTasks()).find((t) => t.title === 'Yesterday')!;
    expect(bucketOf(yesterday, NOW)).toBeNull();
  });
});

describe('sync engine', () => {
  it('keeps previous data and reports the stale source when a connector fails', async () => {
    const ok: Connector = { service: 'asana', account: 'me', fetch: async () => snap(asanaTask()) };
    await runSync(repo, [ok], NOW);
    const broken: Connector = { service: 'asana', account: 'me', fetch: async () => { throw new Error('401 token expired'); } };
    const { reports: [report] } = await runSync(repo, [broken], later(30));
    expect(report).toMatchObject({ ok: false, error: '401 token expired' });
    expect(await repo.listTasks()).toHaveLength(1);
    const [status] = await repo.getSyncStatus();
    expect(status.lastError).toBe('401 token expired');
    expect(status.lastSuccessAt).toBe(NOW.toISOString());
  });

  it('runs the sample world end to end: edits survive a simulated refresh', async () => {
    await runSync(repo, sampleConnectors(NOW, 0), NOW);
    let tasks = await repo.listTasks();
    const brief = tasks.find((t) => t.sourceTitle === 'Finalise Q4 campaign brief')!;
    const agenda = tasks.find((t) => t.title === 'Draft agenda')!;
    const lunch = tasks.find((t) => t.title.includes('lunch'));
    expect(lunch).toBeUndefined(); // routine mail is not a task
    await repo.editTask(brief.id, { notes: 'ask Sam for numbers', priority: 3 }, NOW);
    const reviewBefore = tasks.filter((t) => bucketOf(t, NOW) === 'review').length;

    await runSync(repo, sampleConnectors(NOW, 1), later(30));
    tasks = await repo.listTasks();
    const brief2 = tasks.find((t) => t.id === brief.id)!;
    expect(brief2).toMatchObject({ title: 'Finalise Q4 campaign brief (v2)', notes: 'ask Sam for numbers', priority: 3 });
    expect(tasks.find((t) => t.id === agenda.id)!.sources[0].status).toBe('unavailable');
    expect(tasks.filter((t) => bucketOf(t, NOW) === 'review')).toHaveLength(reviewBefore + 1);
    const unclear = tasks.find((t) => t.ownerConfidence === 'unclear')!;
    expect(unclear.dueAt).toBeNull(); // "the 15th" is not turned into an invented date
  });
});

describe('deleting', () => {
  it('a deleted task stays deleted when its source is synced again', async () => {
    await repo.applySync('asana', 'me', snap(asanaTask()), NOW);
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [msg('m1', true)] }, NOW);
    for (const t of await repo.listTasks()) {
      await repo.setCompleted(t.id, true, NOW);
      await repo.deleteTask(t.id);
    }
    // same items re-sent, one even with a changed due date
    await repo.applySync('asana', 'me', snap(asanaTask({ dueAt: '2026-10-09' })), later(30));
    await repo.applySync('slack', 'me', { mode: 'incremental', records: [{ ...msg('m1', true), suggestion: undefined }] }, later(30));
    expect(await repo.listTasks()).toHaveLength(0);
  });
});
