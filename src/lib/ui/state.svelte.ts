import { TaskRepository } from '../core/repo';
import type { SyncStatus, TaskEdit, TaskView } from '../core/types';
import { isTauri, openDb } from '../db/open';
import { runSync, SYNC_INTERVAL_MS, type Connector } from '../sync/engine';
import { sampleConnectors } from '../sync/sample';

class AppState {
  tasks = $state<TaskView[]>([]);
  status = $state<SyncStatus[]>([]);
  now = $state(new Date());
  syncing = $state(false);
  ready = $state(false);
  sampleMode = $state(false);
  sampleGeneration = $state(0);
  error = $state<string | null>(null);
  repo!: TaskRepository;

  async init() {
    try {
      this.repo = new TaskRepository(await openDb());
      this.sampleMode = (await this.repo.getSetting('sample_mode')) === '1';
      this.sampleGeneration = Number((await this.repo.getSetting('sample_generation')) ?? 0);
      await this.reload();
      this.ready = true;
      void this.sync();
      setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
      setInterval(() => (this.now = new Date()), 60_000);
      if (isTauri()) {
        const { listen } = await import('@tauri-apps/api/event');
        await listen('refresh-requested', () => void this.sync());
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async reload() {
    this.tasks = await this.repo.listTasks();
    this.status = await this.repo.getSyncStatus();
    this.now = new Date();
  }

  private async connectors(): Promise<Connector[]> {
    if (!this.sampleMode) return []; // Phase 2+: real connectors go here
    const anchor = new Date((await this.repo.getSetting('sample_anchor')) ?? Date.now());
    return sampleConnectors(anchor, this.sampleGeneration);
  }

  async sync() {
    if (this.syncing || !this.repo) return;
    this.syncing = true;
    try {
      await runSync(this.repo, await this.connectors());
      await this.reload();
    } finally {
      this.syncing = false;
    }
  }

  /** Run a mutation and refresh the view. */
  private async act(fn: (now: Date) => Promise<unknown>) {
    await fn(new Date());
    await this.reload();
  }

  edit = (id: number, e: TaskEdit) => this.act((n) => this.repo.editTask(id, e, n));
  setCompleted = (id: number, done: boolean) => this.act((n) => this.repo.setCompleted(id, done, n));
  dismiss = (id: number) => this.act((n) => this.repo.dismiss(id, n));
  restore = (id: number) => this.act((n) => this.repo.restore(id, n));
  snooze = (id: number, until: Date) => this.act((n) => this.repo.snooze(id, until, n));
  acknowledge = (id: number) => this.act((n) => this.repo.acknowledgeChange(id, n));
  accept = (id: number) => this.act((n) => this.repo.acceptSuggestion(id, n));
  reject = (id: number) => this.act((n) => this.repo.rejectSuggestion(id, n));
  remove = (id: number) => this.act(() => this.repo.deleteTask(id));
  addTask = (title: string, dueAt: string | null) => this.act((n) => this.repo.addPersonalTask(title, n, dueAt));
  addSubtask = (taskId: number, title: string) => this.act((n) => this.repo.addSubtask(taskId, title, n));
  updateSubtask = (id: number, patch: { title?: string; done?: boolean }) => this.act(() => this.repo.updateSubtask(id, patch));
  deleteSubtask = (id: number) => this.act(() => this.repo.deleteSubtask(id));

  async loadSample() {
    await this.repo.setSetting('sample_mode', '1');
    await this.repo.setSetting('sample_anchor', new Date().toISOString());
    await this.repo.setSetting('sample_generation', '0');
    this.sampleMode = true;
    this.sampleGeneration = 0;
    await this.sync();
  }

  /** Phase 1 acceptance aid: make the fake sources change, then sync. */
  async simulateRefresh() {
    this.sampleGeneration += 1;
    await this.repo.setSetting('sample_generation', String(this.sampleGeneration));
    await this.sync();
  }

  async clearData() {
    await this.repo.clearAll();
    this.sampleMode = false;
    this.sampleGeneration = 0;
    await this.reload();
  }
}

export const app = new AppState();

export async function openLink(url: string) {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
