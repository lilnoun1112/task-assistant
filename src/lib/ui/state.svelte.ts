import { TaskRepository } from '../core/repo';
import type { SyncStatus, TaskEdit, TaskView } from '../core/types';
import { buildSummary, digestItems } from '../core/views';
import { isTauri, openDb } from '../db/open';
import { DEFAULT_OLLAMA_URL, ollamaDigest, ollamaExtractor, ollamaModels, ollamaVersion } from '../extract/ollama';
import { rulesExtractor } from '../extract/rules';
import type { Extractor, Me } from '../extract/types';
import { runSync, SYNC_INTERVAL_MS, type Connector } from '../sync/engine';
import { sampleConnectors } from '../sync/sample';

export type AiEngine = 'rules' | 'ollama';

export interface AiSettings {
  engine: AiEngine;
  ollamaUrl: string;
  ollamaModel: string;
  meName: string;
  meAliases: string;
}

const AI_DEFAULTS: AiSettings = { engine: 'rules', ollamaUrl: DEFAULT_OLLAMA_URL, ollamaModel: '', meName: '', meAliases: '' };

/** Stable key for the daily brief inputs: regenerate only when these facts change. */
export function digestKey(tasks: TaskView[], now: Date): string {
  const items = digestItems(buildSummary(tasks, now));
  return now.toDateString() + '|' + items.map((i) => `${i.kind}:${i.title}:${i.when ?? ''}`).join('|');
}

class AppState {
  tasks = $state<TaskView[]>([]);
  status = $state<SyncStatus[]>([]);
  now = $state(new Date());
  syncing = $state(false);
  ready = $state(false);
  sampleMode = $state(false);
  sampleGeneration = $state(0);
  error = $state<string | null>(null);
  ai = $state<AiSettings>({ ...AI_DEFAULTS });
  /** Problem with the local model during the last sync (rules were used instead). */
  aiProblem = $state<string | null>(null);
  aiDigest = $state<{ key: string; bullets: string[] } | null>(null);
  digesting = $state(false);
  repo!: TaskRepository;

  async init() {
    try {
      this.repo = new TaskRepository(await openDb());
      this.sampleMode = (await this.repo.getSetting('sample_mode')) === '1';
      this.sampleGeneration = Number((await this.repo.getSetting('sample_generation')) ?? 0);
      const savedAi = await this.repo.getSetting('ai');
      if (savedAi) this.ai = { ...AI_DEFAULTS, ...JSON.parse(savedAi) };
      const savedDigest = await this.repo.getSetting('ai_digest');
      if (savedDigest) this.aiDigest = JSON.parse(savedDigest);
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

  get me(): Me {
    return { name: this.ai.meName.trim(), aliases: this.ai.meAliases.split(',').map((a) => a.trim()).filter(Boolean) };
  }

  private extractor(): Extractor {
    if (this.ai.engine === 'ollama' && this.ai.ollamaModel)
      return ollamaExtractor({ baseUrl: this.ai.ollamaUrl, model: this.ai.ollamaModel });
    return rulesExtractor;
  }

  async sync() {
    if (this.syncing || !this.repo) return;
    this.syncing = true;
    try {
      const { extraction } = await runSync(this.repo, await this.connectors(), new Date(), {
        extractor: this.extractor(),
        me: this.me,
      });
      if (extraction.lastError) this.aiProblem = `${extraction.lastError}. Used keyword rules for ${extraction.fallbacks} message${extraction.fallbacks === 1 ? '' : 's'}.`;
      else if (extraction.analysed) this.aiProblem = null;
      await this.reload();
    } finally {
      this.syncing = false;
    }
    void this.refreshDigest();
  }

  // ---------------------------------------------------------------- local AI

  async saveAi(patch: Partial<AiSettings>) {
    this.ai = { ...this.ai, ...patch };
    await this.repo.setSetting('ai', JSON.stringify(this.ai));
    if (patch.engine || patch.ollamaModel) {
      this.aiProblem = null;
      this.aiDigest = null;
      void this.refreshDigest();
    }
  }

  /** Check the Ollama connection; returns installed models or throws a readable error. */
  async testOllama(): Promise<{ version: string; models: string[] }> {
    const opts = { baseUrl: this.ai.ollamaUrl };
    const [version, models] = await Promise.all([ollamaVersion(opts), ollamaModels(opts)]);
    return { version, models };
  }

  /** AI daily brief; the popup falls back to the deterministic digest whenever this is missing or stale. */
  async refreshDigest(force = false) {
    if (this.ai.engine !== 'ollama' || !this.ai.ollamaModel || this.digesting) return;
    const now = new Date();
    const key = digestKey(this.tasks, now);
    if (!force && this.aiDigest?.key === key) return;
    const items = digestItems(buildSummary(this.tasks, now));
    this.digesting = true;
    try {
      const bullets = await ollamaDigest({ baseUrl: this.ai.ollamaUrl, model: this.ai.ollamaModel }, items, this.me, now);
      this.aiDigest = { key, bullets };
      await this.repo.setSetting('ai_digest', JSON.stringify(this.aiDigest));
    } catch (e) {
      // Keep a sync-time warning if there is one; it already explains the outage.
      this.aiProblem ??= `Daily brief: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.digesting = false;
    }
  }

  /** Run a mutation and refresh the view. */
  private async act(fn: (now: Date) => Promise<unknown>) {
    await fn(new Date());
    await this.reload();
    // Edits can change the brief's facts; regenerate once things settle rather than per click.
    clearTimeout(this.digestTimer);
    this.digestTimer = setTimeout(() => void this.refreshDigest(), 4000);
  }
  private digestTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.ai = { ...AI_DEFAULTS };
    this.aiDigest = null;
    this.aiProblem = null;
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
