<script lang="ts">
  import { formatDue, formatRelative } from '../core/dates';
  import type { TaskView } from '../core/types';
  import SourceBadge from './SourceBadge.svelte';
  import { app } from './state.svelte';

  let { task, now }: { task: TaskView; now: Date } = $props();

  const CONFIDENCE = {
    me: { label: 'Asked of you', cls: 'ok' },
    unclear: { label: 'Owner unclear', cls: 'warn' },
    others: { label: 'Probably someone else', cls: 'muted' },
  } as const;
  const conf = $derived(task.ownerConfidence ? CONFIDENCE[task.ownerConfidence] : null);
</script>

<li class="card">
  <div class="head">
    <strong class="action">{task.title}</strong>
    {#if conf}<span class="badge {conf.cls}">{conf.label}</span>{/if}
  </div>
  <div class="why">{task.reason}</div>
  {#if task.evidence || task.excerpt}<blockquote title={task.evidence ? 'The words this suggestion is based on' : ''}>{task.evidence ?? task.excerpt}</blockquote>{/if}
  <div class="meta">
    {#if task.sender}<span class="badge">From {task.sender}</span>{/if}
    <span class="badge">{task.dueAt ? `Due ${formatDue(task.dueAt, now)}` : 'No deadline stated'}</span>
    <span class="badge">{formatRelative(task.createdAt, now)}</span>
    {#if task.extractedBy === 'ollama'}<span class="badge" title="Suggested by your local AI model">Local AI</span>
    {:else if task.extractedBy === 'rules'}<span class="badge" title="Suggested by keyword rules">Rules</span>{/if}
    {#each task.sources as s (s.sourceId)}<SourceBadge service={s.service} url={s.url} unavailable={s.status === 'unavailable'} />{/each}
  </div>
  <div class="buttons">
    <button class="primary" onclick={() => app.accept(task.id)}>Add to my tasks</button>
    <button onclick={() => app.reject(task.id)}>Not a task</button>
  </div>
</li>

<style>
  .card {
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .action {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .why {
    font-size: 12px;
    color: var(--muted);
  }
  blockquote {
    margin: 0;
    padding: 6px 10px;
    border-left: 3px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  .meta,
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .buttons {
    gap: 6px;
    margin-top: 2px;
  }
  .buttons button {
    font-size: 12px;
  }
  .ok {
    background: color-mix(in srgb, var(--ok) 15%, transparent);
    color: var(--ok);
  }
  .warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
</style>
