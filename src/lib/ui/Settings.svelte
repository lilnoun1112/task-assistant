<script lang="ts">
  import { formatRelative } from '../core/dates';
  import { SERVICE_LABEL, SOURCE_SERVICES } from '../core/types';
  import { app } from './state.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let confirmClear = $state(false);

  let models = $state<string[]>([]);
  let checking = $state(false);
  let check = $state<{ ok: boolean; text: string } | null>(null);

  async function testConnection() {
    checking = true;
    check = null;
    try {
      const r = await app.testOllama();
      models = r.models;
      if (!r.models.length) check = { ok: false, text: `Ollama ${r.version} is running, but no models are installed yet. Run: ollama pull qwen3:8b` };
      else {
        check = { ok: true, text: `Connected to Ollama ${r.version} · ${r.models.length} model${r.models.length === 1 ? '' : 's'}` };
        if (!r.models.includes(app.ai.ollamaModel))
          await app.saveAi({ ollamaModel: r.models.find((m) => /:(7|8)b\b/.test(m)) ?? r.models[0] });
      }
    } catch (e) {
      check = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      checking = false;
    }
  }

  $effect(() => {
    if (app.ai.engine === 'ollama' && !models.length && !checking && !check) void testConnection();
  });
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

  <h3>Reading mail and DMs</h3>
  <p class="muted small">How new emails and Slack DMs are checked for requests. Suggestions always land in Review first; nothing becomes a task without you.</p>
  <div class="engine">
    <label><input type="radio" name="engine" checked={app.ai.engine === 'rules'} onchange={() => app.saveAi({ engine: 'rules' })} /> Keyword rules <span class="muted">· no setup, catches obvious requests</span></label>
    <label><input type="radio" name="engine" checked={app.ai.engine === 'ollama'} onchange={() => app.saveAi({ engine: 'ollama' })} /> Local AI model (Ollama) <span class="muted">· free, runs on this computer</span></label>
  </div>

  {#if app.ai.engine === 'ollama'}
    <div class="ai">
      <label class="field">
        <span>Ollama address</span>
        <input type="text" value={app.ai.ollamaUrl} onchange={(e) => app.saveAi({ ollamaUrl: (e.target as HTMLInputElement).value.trim() })} />
      </label>
      <div class="row">
        <button onclick={testConnection} disabled={checking}>{checking ? 'Checking…' : 'Check connection'}</button>
        {#if check}<span class="small" class:ok={check.ok} class:err={!check.ok}>{check.text}</span>{/if}
      </div>
      <label class="field">
        <span>Model</span>
        <select value={app.ai.ollamaModel} onchange={(e) => app.saveAi({ ollamaModel: (e.target as HTMLSelectElement).value })} disabled={!models.length && !app.ai.ollamaModel}>
          {#if !models.includes(app.ai.ollamaModel)}<option value={app.ai.ollamaModel}>{app.ai.ollamaModel || 'Check connection first'}</option>{/if}
          {#each models as m}<option value={m}>{m}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Your name (so the model knows who “you” are)</span>
        <input type="text" placeholder="e.g. Marcell" value={app.ai.meName} onchange={(e) => app.saveAi({ meName: (e.target as HTMLInputElement).value })} />
      </label>
      <label class="field">
        <span>Other names or handles, comma separated</span>
        <input type="text" placeholder="e.g. Marci, @marcell" value={app.ai.meAliases} onchange={(e) => app.saveAi({ meAliases: (e.target as HTMLInputElement).value })} />
      </label>
      <details class="small muted">
        <summary>How to set up Ollama</summary>
        <ol>
          <li>Install Ollama from ollama.com and start it.</li>
          <li>In a terminal run <code>ollama pull qwen3:8b</code> (about 5 GB; needs ~8 GB free memory). On a lighter laptop try <code>qwen3:4b</code>.</li>
          <li>Click “Check connection”, pick the model, and enter your name.</li>
        </ol>
        If the model is slow or Ollama isn't running, the app quietly uses keyword rules and tells you.
      </details>
    </div>
  {/if}

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
  .engine {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .engine .muted {
    font-size: 12px;
  }
  .ai {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
  }
  .field input,
  .field select {
    font-size: 13px;
    color: var(--text);
  }
  .ok {
    color: var(--ok);
  }
  details ol {
    padding-left: 18px;
    margin: 6px 0;
  }
  code {
    font-size: 11px;
    background: var(--surface-2);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .foot {
    margin-top: 20px;
  }
</style>
