<script lang="ts">
  import { addDays, dayKey, formatDue, startOfDay } from '../core/dates';
  import { PRIORITY_LABEL, SERVICE_LABEL, type TaskView } from '../core/types';
  import { isOverdue } from '../core/views';
  import SourceBadge from './SourceBadge.svelte';
  import { app } from './state.svelte';

  let { task, now }: { task: TaskView; now: Date } = $props();

  let open = $state(false);
  let newSub = $state('');
  // Delete needs two clicks: the first arms the button for a few seconds.
  let confirmDelete = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function deleteClick() {
    if (confirmDelete) {
      clearTimeout(confirmTimer);
      app.remove(task.id);
      return;
    }
    confirmDelete = true;
    confirmTimer = setTimeout(() => (confirmDelete = false), 3000);
  }

  const done = $derived(!!task.completedAt);
  const overdue = $derived(isOverdue(task, now));
  const meeting = $derived(task.kind === 'meeting');
  const allGone = $derived(task.sources.length > 0 && task.sources.every((s) => s.status === 'unavailable'));
  const closed = $derived(!!task.completedAt || !!task.dismissedAt || (task.snoozedUntil && new Date(task.snoozedUntil) > now));
  const subDone = $derived(task.subtasks.filter((s) => s.done).length);

  function meetingTime(t: TaskView) {
    if (!t.startsAt) return '';
    const start = formatDue(t.startsAt, now);
    if (!t.endsAt) return start;
    return `${start}–${new Date(t.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }

  function snoozeOptions() {
    const tomorrow9 = startOfDay(now, 1);
    tomorrow9.setHours(9);
    const nextMonday = startOfDay(now, ((8 - now.getDay()) % 7) || 7);
    nextMonday.setHours(9);
    return [
      { label: 'In 3 hours', until: new Date(now.getTime() + 3 * 3600_000) },
      { label: 'Tomorrow 9:00', until: tomorrow9 },
      { label: 'Next Monday', until: nextMonday },
    ];
  }

  function saveTitle(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v.trim() && v !== task.title) app.edit(task.id, { title: v });
  }
</script>

<li class="row" class:done class:open class:changed={!!task.sourceChangedAt}>
  <div class="line">
    <input
      type="checkbox"
      checked={done}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      onchange={(e) => app.setCompleted(task.id, (e.target as HTMLInputElement).checked)}
    />
    <button class="title-btn" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="title">{task.title || 'Untitled'}</span>
      <span class="meta">
        {#if meeting}
          <span class="badge">🗓 {meetingTime(task)}</span>
        {:else if task.dueAt}
          <span class="badge" class:overdue>{overdue ? 'Overdue · ' : ''}{formatDue(task.dueAt, now)}</span>
        {/if}
        {#if task.priority > 0}<span class="badge prio p{task.priority}">{PRIORITY_LABEL[task.priority]}</span>{/if}
        {#if task.subtasks.length}<span class="badge">☑ {subDone}/{task.subtasks.length}</span>{/if}
        {#if task.notes}<span class="badge" title="Has notes">✎</span>{/if}
        {#if task.sourceChangedAt}<span class="badge flag">Changed in source</span>{/if}
        {#if allGone}<span class="badge flag">Original unavailable</span>{/if}
        {#if task.snoozedUntil && new Date(task.snoozedUntil) > now}<span class="badge">💤 until {formatDue(task.snoozedUntil, now)}</span>{/if}
        {#each task.sources as s (s.service + s.sourceId)}<span class="badge"><span class="dot" style:background="var(--{s.service})"></span>{SERVICE_LABEL[s.service]}</span>{/each}
        {#if task.origin === 'personal'}<span class="badge"><span class="dot" style:background="var(--local)"></span>Personal</span>{/if}
      </span>
    </button>
    {#if done}
      <button
        class="ghost trash"
        class:armed={confirmDelete}
        title={confirmDelete ? 'Click again to delete' : 'Delete'}
        aria-label={confirmDelete ? 'Confirm delete' : 'Delete task'}
        onclick={deleteClick}
      >
        {#if confirmDelete}Delete?{:else}<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
      </button>
    {/if}
  </div>

  {#if open}
    <div class="editor">
      {#if task.sourceChangedAt}
        <div class="notice">
          The original changed (title or date) since you last looked. If you had closed this, it was reopened.
          <button class="ghost" onclick={() => app.acknowledge(task.id)}>Got it</button>
        </div>
      {/if}

      <label class="field">
        <span>Title</span>
        <input type="text" value={task.title} onchange={saveTitle} />
      </label>
      {#if task.titleEdited && task.sourceTitle}
        <div class="hint">
          Source says “{task.sourceTitle}”.
          <button class="ghost" onclick={() => app.edit(task.id, { title: null })}>Use source title</button>
        </div>
      {/if}

      <div class="grid">
        {#if !meeting}
          <label class="field">
            <span>Due</span>
            <input
              type="date"
              value={task.dueAt ? dayKey(task.dueAt) : ''}
              onchange={(e) => app.edit(task.id, { dueAt: (e.target as HTMLInputElement).value || null })}
            />
          </label>
        {/if}
        <label class="field">
          <span>Priority</span>
          <select value={task.priority} onchange={(e) => app.edit(task.id, { priority: Number((e.target as HTMLSelectElement).value) })}>
            {#each PRIORITY_LABEL as label, i}<option value={i}>{label}</option>{/each}
          </select>
        </label>
      </div>
      {#if task.dueEdited && task.origin !== 'personal'}
        <div class="hint"><button class="ghost" onclick={() => app.edit(task.id, { revertDue: true })}>Use source due date</button></div>
      {/if}

      <label class="field">
        <span>Notes</span>
        <textarea rows="3" value={task.notes} onchange={(e) => app.edit(task.id, { notes: (e.target as HTMLTextAreaElement).value })}></textarea>
      </label>

      {#if task.excerpt}
        <blockquote class="excerpt">{task.excerpt}</blockquote>
      {/if}
      {#if task.context}<div class="hint">Context: {task.context}</div>{/if}

      <div class="subtasks">
        {#each task.subtasks as s (s.id)}
          <div class="sub">
            <input type="checkbox" checked={s.done} onchange={(e) => app.updateSubtask(s.id, { done: (e.target as HTMLInputElement).checked })} />
            <input type="text" value={s.title} onchange={(e) => app.updateSubtask(s.id, { title: (e.target as HTMLInputElement).value })} />
            <button class="ghost" aria-label="Delete subtask" onclick={() => app.deleteSubtask(s.id)}>×</button>
          </div>
        {/each}
        <form
          class="sub"
          onsubmit={(e) => {
            e.preventDefault();
            if (newSub.trim()) app.addSubtask(task.id, newSub).then(() => (newSub = ''));
          }}
        >
          <span class="plus">+</span>
          <input type="text" placeholder="Add subtask" bind:value={newSub} />
        </form>
      </div>

      <div class="sources">
        {#each task.sources as s (s.service + s.sourceId)}
          <SourceBadge service={s.service} url={s.url} unavailable={s.status === 'unavailable'} />
        {/each}
      </div>

      <div class="actions">
        {#if closed}
          <button onclick={() => app.restore(task.id)}>Restore</button>
        {:else}
          {#each snoozeOptions() as o}
            <button onclick={() => app.snooze(task.id, o.until)}>💤 {o.label}</button>
          {/each}
          <button onclick={() => app.dismiss(task.id)}>Dismiss</button>
        {/if}
        {#if task.origin === 'personal' || allGone || done}
          <button class="danger" onclick={() => app.remove(task.id)}>Delete</button>
        {/if}
      </div>
    </div>
  {/if}
</li>

<style>
  .row {
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 6px;
  }
  .row.changed {
    border-color: var(--warn);
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
  }
  .line > input[type='checkbox'] {
    margin-top: 3px;
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    flex: none;
  }
  .trash {
    flex: none;
    align-self: center;
    height: 26px;
    min-width: 26px;
    padding: 0 6px;
    display: inline-grid;
    place-items: center;
    color: var(--muted);
    font-size: 12px;
  }
  .trash:hover {
    color: var(--danger);
  }
  .trash.armed {
    color: white;
    background: var(--danger);
  }
  .title-btn {
    all: unset;
    cursor: pointer;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .title {
    overflow-wrap: anywhere;
    line-height: 1.35;
  }
  .done .title {
    text-decoration: line-through;
    color: var(--muted);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .overdue {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .flag {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .prio.p3 {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .prio.p2 {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .editor {
    border-top: 1px solid var(--border);
    padding: 10px 12px 12px 34px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
  }
  .field input,
  .field textarea,
  .field select {
    font-size: 13px;
    color: var(--text);
  }
  textarea {
    resize: vertical;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .hint button,
  .notice button {
    font-size: 12px;
    padding: 1px 6px;
    color: var(--accent);
  }
  .notice {
    font-size: 12px;
    background: var(--warn-soft);
    color: var(--warn);
    border-radius: 7px;
    padding: 6px 8px;
  }
  .excerpt {
    margin: 0;
    padding: 6px 10px;
    border-left: 3px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    white-space: pre-wrap;
  }
  .subtasks {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sub input[type='text'] {
    flex: 1;
    font-size: 13px;
    padding: 3px 6px;
  }
  .plus {
    width: 13px;
    text-align: center;
    color: var(--muted);
  }
  .sources,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .actions button {
    font-size: 12px;
  }
  .danger {
    color: var(--danger);
  }
</style>
