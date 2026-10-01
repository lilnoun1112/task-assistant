<script lang="ts">
  import { SERVICE_LABEL, type Service } from '../core/types';
  import { openLink } from './state.svelte';

  let { service, url = null, unavailable = false }: { service: Service; url?: string | null; unavailable?: boolean } = $props();
</script>

{#if url && !unavailable}
  <button class="badge" title="Open in {SERVICE_LABEL[service]}" onclick={() => openLink(url)}>
    <span class="dot" style:background="var(--{service})"></span>{SERVICE_LABEL[service]} ↗
  </button>
{:else}
  <span class="badge" title={unavailable ? 'Original deleted or no longer accessible' : ''} class:gone={unavailable}>
    <span class="dot" style:background="var(--{service})"></span>{SERVICE_LABEL[service]}{unavailable ? ' · unavailable' : ''}
  </span>
{/if}

<style>
  .gone {
    text-decoration: line-through;
  }
</style>
