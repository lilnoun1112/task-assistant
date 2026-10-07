<script lang="ts">
  import { formatRelative } from '../core/dates';
  import { SERVICE_LABEL, SOURCE_SERVICES, type Service, type TaskView } from '../core/types';
  import { bucketOf, buildSummary, matches, sortCompleted, sortTasks, type Bucket, type SortMode } from '../core/views';
  import { isTauri } from '../db/open';
  import DailyBrief from './DailyBrief.svelte';
  import ReviewCard from './ReviewCard.svelte';
  import Settings from './Settings.svelte';
  import TaskRow from './TaskRow.svelte';
  import { app } from './state.svelte';

  type Tab = 'pending' | 'done';
  let tab = $state<Tab>('pending');
  let search = $state('');
  let services = $state<Service[]>([]);
  let sort = $state<SortMode>('due');
  let showFilters = $state(false);
  let showSettings = $state(false);
  let newTitle = $state('');
  let newDue = $state('');

  const now = $derived(app.now);
  const summary = $derived(buildSummary(app.tasks, now));
  const byBucket = $derived.by(() => {
    const m: Record<Bucket, TaskView[]> = { today: [], upcoming: [], review: [], completed: [], dismissed: [], snoozed: [] };
    for (const t of app.tasks) {
      const b = bucketOf(t, now);
      if (b) m[b].push(t);
    }
    return m;
  });
  const filtersActive = $derived(search.trim() !== '' || services.length > 0 || sort !== 'due');
  const filter = $derived({ search, services: new Set(services) });
  const visible = (list: TaskView[]) => list.filter((t) => matches(t, filter));

  // Pending = everything still open, in one list. Suggestions from mail/DMs sit on top
  // because they need a yes/no before they become tasks.
  const toReview = $derived(sortTasks(visible(byBucket.review), 'due'));
  const openTasks = $derived(sortTasks(visible([...byBucket.today, ...byBucket.upcoming]), sort));
  const pendingCount = $derived(byBucket.review.length + byBucket.today.length + byBucket.upcoming.length);

  const staleSources = $derived(app.status.filter((s) => s.lastError));
  const lastSync = $derived(
    app.status.reduce<string | null>((acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc), null),
  );

  function toggleService(s: Service) {
    services = services.includes(s) ? services.filter((x) => x !== s) : [...services, s];
  }

  function clearFilters() {
    search = '';
    services = [];
    sort = 'due';
  }

  async function addTask(e: SubmitEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await app.addTask(newTitle, newDue || null);
    newTitle = '';
    newDue = '';
  }

  async function hide() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
  }
</script>

<div class="shell">
  <header data-tauri-drag-region>
    <div class="summary" data-tauri-drag-region>
      <div class="hello" data-tauri-drag-region>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div class="sumtext" data-tauri-drag-region>{summary.text}</div>
    </div>
    <div class="head-actions">
      <button
        class="ghost icon filter-btn"
        class:on={showFilters}
        title="Search, sort and filter"
        aria-label="Search, sort and filter"
        aria-expanded={showFilters}
        onclick={() => (showFilters = !showFilters)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
        {#if filtersActive}<span class="active-dot"></span>{/if}
      </button>
      <button class="ghost icon" title="Refresh now" aria-label="Refresh now" onclick={() => app.sync()} disabled={app.syncing}>
        <span class:spin={app.syncing}>↻</span>
      </button>
      <button class="ghost icon" title="Settings" aria-label="Settings" onclick={() => (showSettings = !showSettings)}>⚙</button>
      {#if isTauri()}<button class="ghost icon" title="Close" aria-label="Close" onclick={hide}>✕</button>{/if}
    </div>
  </header>

  {#if staleSources.length}
    <div class="errors">
      {#each staleSources as s}
        <div>
          <strong>{SERVICE_LABEL[s.service]}</strong> didn’t sync: {s.lastError}.
          {#if s.lastSuccessAt}Showing data from {formatRelative(s.lastSuccessAt, now)}.{/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if app.aiProblem}
    <div class="ai-warn">
      <span><strong>Local AI:</strong> {app.aiProblem}</span>
      <button class="ghost" onclick={() => (app.aiProblem = null)} aria-label="Dismiss">✕</button>
    </div>
  {/if}

  {#if showSettings}
    <Settings onclose={() => (showSettings = false)} />
  {:else}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'pending'} class:active={tab === 'pending'} onclick={() => (tab = 'pending')}>
        Pending {#if pendingCount}<span class="count">{pendingCount}</span>{/if}
      </button>
      <button role="tab" aria-selected={tab === 'done'} class:active={tab === 'done'} onclick={() => (tab = 'done')}>
        Done {#if byBucket.completed.length}<span class="count">{byBucket.completed.length}</span>{/if}
      </button>
    </div>

    {#if showFilters}
      <div class="filters">
        <div class="toolbar">
          <input type="search" placeholder="Search" bind:value={search} aria-label="Search tasks" use:focusOnMount />
          <select bind:value={sort} aria-label="Sort">
            <option value="due">By date</option>
            <option value="priority">By priority</option>
          </select>
        </div>
        <div class="chips">
          {#each [...SOURCE_SERVICES, 'local' as const] as s}
            <button class="chip" class:on={services.includes(s)} onclick={() => toggleService(s)} aria-pressed={services.includes(s)}>
              <span class="dot" style:background="var(--{s})"></span>{SERVICE_LABEL[s]}
            </button>
          {/each}
        </div>
      </div>
    {:else if filtersActive}
      <div class="filtered">
        Filtered{search.trim() ? ` by “${search.trim()}”` : ''}{services.length ? ` · ${services.map((s) => SERVICE_LABEL[s]).join(', ')}` : ''}{sort === 'priority' ? ' · by priority' : ''}
        <button class="ghost" onclick={clearFilters}>Clear</button>
      </div>
    {/if}

    <main>
      {#if !app.ready}
        <p class="empty">{app.error ? `Couldn’t open local storage: ${app.error}` : 'Loading…'}</p>
      {:else if tab === 'pending'}
        <DailyBrief />
        <form class="add" onsubmit={addTask}>
          <input type="text" placeholder="Add a personal task…" bind:value={newTitle} aria-label="New task title" />
          <input type="date" bind:value={newDue} aria-label="Due date" />
          <button class="primary" type="submit" disabled={!newTitle.trim()}>Add</button>
        </form>
        {#if toReview.length}
          <h3>Needs review <span class="muted">· from mail and DMs</span></h3>
          <ul>
            {#each toReview as t (t.id)}<ReviewCard task={t} {now} />{/each}
          </ul>
          {#if openTasks.length}<h3>Tasks</h3>{/if}
        {/if}
        <ul>
          {#each openTasks as t (t.id)}<TaskRow task={t} {now} />{/each}
        </ul>
        {#if !toReview.length && !openTasks.length}
          <p class="empty">
            {#if app.tasks.length === 0}
              No tasks yet. Add one above, or open ⚙ Settings → Load sample data.
            {:else if filtersActive}
              Nothing matches these filters.
            {:else}
              All clear. Nothing pending.
            {/if}
          </p>
        {/if}
      {:else}
        <ul>
          {#each sortCompleted(visible(byBucket.completed)) as t (t.id)}<TaskRow task={t} {now} />{:else}<p class="empty">{filtersActive ? 'Nothing matches these filters.' : 'Nothing completed yet.'}</p>{/each}
        </ul>
        {#if byBucket.snoozed.length}
          <details>
            <summary>Snoozed ({byBucket.snoozed.length})</summary>
            <ul>{#each visible(byBucket.snoozed) as t (t.id)}<TaskRow task={t} {now} />{/each}</ul>
          </details>
        {/if}
        {#if byBucket.dismissed.length}
          <details>
            <summary>Dismissed ({byBucket.dismissed.length})</summary>
            <ul>{#each sortCompleted(visible(byBucket.dismissed)) as t (t.id)}<TaskRow task={t} {now} />{/each}</ul>
          </details>
        {/if}
      {/if}
    </main>
  {/if}

  <footer>
    {#if app.syncing}Syncing…{:else if lastSync}Last synced {formatRelative(lastSync, now)}{:else}Not synced yet{/if}
    {#if app.sampleMode}<span class="badge">Sample data</span>{/if}
  </footer>
</div>

<style>
  .shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 10px;
  }
  .hello {
    font-size: 12px;
    color: var(--muted);
  }
  .sumtext {
    font-weight: 600;
    font-size: 15px;
    margin-top: 2px;
  }
  .head-actions {
    display: flex;
    gap: 2px;
  }
  .icon {
    width: 30px;
    height: 30px;
    padding: 0;
    font-size: 16px;
  }
  .spin {
    display: inline-block;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .errors {
    margin: 0 14px 8px;
    padding: 8px 10px;
    font-size: 12px;
    border-radius: 8px;
    background: var(--danger-soft);
    color: var(--danger);
  }
  .ai-warn {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0 14px 8px;
    padding: 6px 4px 6px 10px;
    font-size: 12px;
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn);
  }
  .ai-warn span {
    flex: 1;
    padding-top: 3px;
  }
  .ai-warn button {
    padding: 0 6px;
    color: inherit;
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    border: 0;
    background: none;
    border-radius: 0;
    padding: 8px 8px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .count {
    font-size: 11px;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 1px 6px;
    margin-left: 3px;
    font-weight: 500;
  }
  .filter-btn {
    position: relative;
    display: inline-grid;
    place-items: center;
  }
  .filter-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .active-dot {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .filters {
    border-bottom: 1px solid var(--border);
    padding-bottom: 2px;
  }
  .filtered {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .filtered button {
    font-size: 12px;
    padding: 1px 6px;
    color: var(--accent);
  }
  h3 .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .toolbar {
    display: flex;
    gap: 6px;
    padding: 10px 14px 6px;
  }
  .toolbar input {
    flex: 1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 14px 8px;
  }
  .chip {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--text);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  main {
    flex: 1;
    overflow-y: auto;
    padding: 4px 14px 14px;
  }
  ul {
    margin: 0;
    padding: 0;
  }
  h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 12px 0 6px;
  }
  .add {
    display: flex;
    gap: 6px;
    margin: 4px 0 4px;
  }
  .add input[type='text'] {
    flex: 1;
  }
  .add input[type='date'] {
    width: 130px;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
    text-align: center;
    margin: 24px 0;
  }
  details {
    margin-top: 12px;
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
    margin-bottom: 6px;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    font-size: 11px;
    color: var(--muted);
    border-top: 1px solid var(--border);
  }
</style>
