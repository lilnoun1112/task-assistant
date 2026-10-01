<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  // Click toggles the popup; press-and-move drags the window.
  let start: { x: number; y: number } | null = null;
  let blink = $state(false);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    start = { x: e.screenX, y: e.screenY };
  }
  async function move(e: PointerEvent) {
    if (!start) return;
    if (Math.hypot(e.screenX - start.x, e.screenY - start.y) > 4) {
      start = null;
      await getCurrentWindow().startDragging();
    }
  }
  async function up() {
    if (!start) return;
    start = null;
    await invoke('toggle_popup');
  }

  setInterval(() => {
    blink = true;
    setTimeout(() => (blink = false), 160);
  }, 4200);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sprite" onpointerdown={down} onpointermove={move} onpointerup={up} title="Task assistant">
  <svg viewBox="0 0 96 96" width="80" height="80" aria-hidden="true">
    <ellipse cx="48" cy="88" rx="24" ry="4" fill="rgba(0,0,0,.18)" />
    <path d="M18 54c0-19 13-36 30-36s30 17 30 36c0 16-12 28-30 28S18 70 18 54z" fill="#6c63ff" />
    <path d="M26 52c0-14 10-27 22-27" stroke="#9b95ff" stroke-width="5" stroke-linecap="round" fill="none" />
    <circle cx="48" cy="14" r="5" fill="#ffcf5c" />
    <path d="M48 19v-0" stroke="#6c63ff" stroke-width="3" />
    {#if blink}
      <path d="M33 52h8M55 52h8" stroke="#1f1d1a" stroke-width="3" stroke-linecap="round" />
    {:else}
      <ellipse cx="37" cy="52" rx="4" ry="5.5" fill="#1f1d1a" />
      <ellipse cx="59" cy="52" rx="4" ry="5.5" fill="#1f1d1a" />
      <circle cx="38.5" cy="50" r="1.4" fill="#fff" />
      <circle cx="60.5" cy="50" r="1.4" fill="#fff" />
    {/if}
    <path d="M42 64q6 5 12 0" stroke="#1f1d1a" stroke-width="3" stroke-linecap="round" fill="none" />
    <circle cx="29" cy="61" r="3.5" fill="#ff8fab" opacity=".7" />
    <circle cx="67" cy="61" r="3.5" fill="#ff8fab" opacity=".7" />
  </svg>
</div>

<style>
  .sprite {
    width: 100vw;
    height: 100vh;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  svg {
    transition: transform 0.15s ease;
  }
  .sprite:hover svg {
    transform: translateY(-2px) scale(1.03);
  }
</style>
