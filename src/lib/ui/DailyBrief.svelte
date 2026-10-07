<script lang="ts">
  import { buildSummary, deterministicDigest } from '../core/views';
  import { app, digestKey } from './state.svelte';

  let open = $state(true);

  const now = $derived(app.now);
  const key = $derived(digestKey(app.tasks, now));
  const aiFresh = $derived(app.ai.engine === 'ollama' && app.aiDigest?.key === key && app.aiDigest.bullets.length > 0);
  const bullets = $derived(aiFresh ? app.aiDigest!.bullets : deterministicDigest(buildSummary(app.tasks, now)));
</script>

{#if bullets.length}
  <section class="brief">
    <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
      <span>Daily brief</span>
      <span class="badge">{aiFresh ? 'Local AI' : 'Auto'}</span>
      {#if app.digesting}<span class="muted small">writing…</span>{/if}
      <span class="chev">{open ? '▾' : '▸'}</span>
    </button>
    {#if open}
      <ul>
        {#each bullets as b}<li>{b}</li>{/each}
      </ul>
      {#if app.ai.engine === 'ollama' && app.ai.ollamaModel}
        <button class="ghost regen" onclick={() => app.refreshDigest(true)} disabled={app.digesting}>Rewrite brief</button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .brief {
    background: var(--accent-soft);
    border-radius: var(--radius);
    padding: 8px 12px;
    margin: 6px 0 8px;
  }
  .head {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .head .badge {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
  .chev {
    margin-left: auto;
    color: var(--muted);
  }
  .small {
    font-size: 11px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  ul {
    margin: 6px 0 2px;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.45;
  }
  .regen {
    font-size: 11px;
    padding: 1px 6px;
    color: var(--accent);
  }
</style>
