<script lang="ts">
  import { formatRelative } from '../core/dates';
  import { SERVICE_LABEL, SOURCE_SERVICES } from '../core/types';
  import { app } from './state.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let confirmClear = $state(false);
</script>

<section class="settings">
  <div class="top">
    <h2>Settings</h2>
    <button class="ghost" onclick={onclose}>Done</button>
  </div>

  <h3>Connections</h3>
  <ul class="conns">
    {#each SOURCE_SERVICES as s}
      {@const st = app.status.find((x) => x.service === s)}
      <li>
        <span class="dot" style:background="var(--{s})"></span>
        <span class="name">{SERVICE_LABEL[s]}</span>
        {#if st?.lastError}
          <span class="err">Error: {st.lastError}</span>
        {:else if st?.lastSuccessAt}
          <span class="muted">{st.account === 'sample' ? 'Sample data' : st.account} · {formatRelative(st.lastSuccessAt, app.now)}</span>
        {:else}
          <span class="muted">Not connected (coming in phase {s === 'gmail' || s === 'slack' ? 3 : 2})</span>
        {/if}
      </li>
    {/each}
  </ul>

  <h3>Sample data</h3>
  <p class="muted small">Fake Asana, Doc, Calendar, Gmail and Slack items for trying the app. “Simulate refresh” makes the fake sources change (a renamed task, a moved deadline, a ticked Doc item, a new email) so you can check your edits survive.</p>
  <div class="row">
    <button onclick={() => app.loadSample()}>{app.sampleMode ? 'Reload sample data' : 'Load sample data'}</button>
    <button onclick={() => app.simulateRefresh()} disabled={!app.sampleMode}>Simulate refresh</button>
  </div>

  <h3>Privacy</h3>
  <p class="muted small">Everything is stored only on this computer. Nothing is ever written back to Asana, Google or Slack.</p>
  {#if confirmClear}
    <div class="row">
      <span class="small">Delete all local tasks, edits and stored message excerpts?</span>
      <button class="danger" onclick={() => app.clearData().then(() => (confirmClear = false))}>Delete everything</button>
      <button onclick={() => (confirmClear = false)}>Cancel</button>
    </div>
  {:else}
    <button class="danger" onclick={() => (confirmClear = true)}>Clear local data…</button>
  {/if}

  <p class="muted small foot">Always-on-top and launch at login are in the tray menu.</p>
</section>

<style>
  .settings {
    flex: 1;
    overflow-y: auto;
    padding: 0 14px 14px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 15px;
    margin: 6px 0;
  }
  h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 16px 0 6px;
  }
  .conns {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .conns li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 7px 10px;
  }
  .name {
    flex: 1;
  }
  .conns .muted,
  .err {
    font-size: 12px;
  }
  .err {
    color: var(--danger);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .small {
    font-size: 12px;
    margin: 4px 0 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .danger {
    color: var(--danger);
  }
  .foot {
    margin-top: 20px;
  }
</style>
