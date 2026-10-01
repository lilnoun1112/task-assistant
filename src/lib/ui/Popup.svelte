<script lang="ts">
  import { formatRelative } from '../core/dates';
  import { SERVICE_LABEL, SOURCE_SERVICES, type Service, type TaskView } from '../core/types';
  import { bucketOf, buildSummary, isOverdue, matches, sortCompleted, sortTasks, type Bucket, type SortMode } from '../core/views';
  import { isTauri } from '../db/open';
  import ReviewCard from './ReviewCard.svelte';
  import Settings from './Settings.svelte';
  import TaskRow from './TaskRow.svelte';
  import { app } from './state.svelte';

  type Tab = 'today' | 'upcoming' | 'review' | 'completed';
  let tab = $state<Tab>('today');
  let search = $state('');
  let services = $state<Service[]>([]);
  let sort = $state<SortMode>('due');
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
  const filter = $derived({ search, services: new Set(services) });
  const visible = (list: TaskView[]) => list.filter((t) => matches(t, filter));

  const todayGroups = $derived.by(() => {
    const list = sortTasks(visible(byBucket.today), sort);
    return [
      { label: 'Overdue', items: list.filter((t) => isOverdue(t, now)) },
      { label: 'Meetings', items: list.filter((t) => t.kind === 'meeting') },
      { label: 'Due today', items: list.filter((t) => t.kind !== 'meeting' && !isOverdue(t, now)) },
    ].filter((g) => g.items.length);
  });
  const upcomingGroups = $derived.by(() => {
    const list = sortTasks(visible(byBucket.upcoming), sort);
    const dated = list.filter((t) => t.dueAt || t.startsAt);
    const undated = list.filter((t) => !t.dueAt && !t.startsAt);
    return sort === 'priority'
      ? [{ label: '', items: list }]
      : [
          { label: 'Scheduled', items: dated },
          { label: 'No date', items: undated },
        ].filter((g) => g.items.length);
  });

  const staleSources = $derived(app.status.filter((s) => s.lastError));
  const lastSync = $derived(
    app.status.reduce<string | null>((acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc), null),
  );

  function toggleService(s: Service) {
    services = services.includes(s) ? services.filter((x) => x !== s) : [...services, s];
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

  const tabs: { id: Tab; label: string; count: () => number }[] = [
    { id: 'today', label: 'Today', count: () => byBucket.today.length },
    { id: 'upcoming', label: 'Upcoming', count: () => byBucket.upcoming.length },
    { id: 'review', label: 'Review', count: () => byBucket.review.length },
    { id: 'completed', label: 'Done', count: () => byBucket.completed.length },
  ];
</script>

<div class="shell">
  <header data-tauri-drag-region>
    <div class="summary" data-tauri-drag-region>
      <div class="hello" data-tauri-drag-region>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div class="sumtext" data-tauri-drag-region>{summary.text}</div>
    </div>
    <div class="head-actions">
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

  {#if showSettings}
    <Settings onclose={() => (showSettings = false)} />
  {:else}
    <div class="tabs" role="tablist">
      {#each tabs as t}
        <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>
          {t.label}
          {#if t.count()}<span class="count" class:attention={t.id === 'review'}>{t.count()}</span>{/if}
        </button>
      {/each}
    </div>

    <div class="toolbar">
      <input type="search" placeholder="Search" bind:value={search} aria-label="Search tasks" />
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

    <main>
      {#if !app.ready}
        <p class="empty">{app.error ? `Couldn’t open local storage: ${app.error}` : 'Loading…'}</p>
      {:else if tab === 'today' || tab === 'upcoming'}
        <form class="add" onsubmit={addTask}>
          <input type="text" placeholder="Add a personal task…" bind:value={newTitle} aria-label="New task title" />
          <input type="date" bind:value={newDue} aria-label="Due date" />
          <button class="primary" type="submit" disabled={!newTitle.trim()}>Add</button>
        </form>
        {@const groups = tab === 'today' ? todayGroups : upcomingGroups}
        {#each groups as g (g.label)}
          {#if g.label}<h3>{g.label}</h3>{/if}
          <ul>
            {#each g.items as t (t.id)}<TaskRow task={t} {now} />{/each}
          </ul>
        {:else}
          <p class="empty">
            {#if app.tasks.length === 0}
              No tasks yet. Add one above, or open ⚙ Settings → Load sample data.
            {:else if search || services.length}
              Nothing matches these filters.
            {:else}
              {tab === 'today' ? 'Nothing due today.' : 'Nothing upcoming.'}
            {/if}
          </p>
        {/each}
      {:else if tab === 'review'}
        <p class="explain">Requests found in mail and DMs. Nothing here becomes a task until you add it.</p>
        <ul>
          {#each sortTasks(visible(byBucket.review), 'due').reverse() as t (t.id)}<ReviewCard task={t} {now} />{:else}<p class="empty">All caught up.</p>{/each}
        </ul>
      {:else}
        <ul>
          {#each sortCompleted(visible(byBucket.completed)) as t (t.id)}<TaskRow task={t} {now} />{:else}<p class="empty">Nothing completed yet.</p>{/each}
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
  .count.attention {
    background: var(--accent);
    color: white;
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
  .empty,
  .explain {
    color: var(--muted);
    font-size: 13px;
    text-align: center;
    margin: 24px 0;
  }
  .explain {
    text-align: left;
    font-size: 12px;
    margin: 6px 0 10px;
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
