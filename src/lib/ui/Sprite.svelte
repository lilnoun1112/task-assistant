<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import spriteUrl from '../../assets/sprite.svg';

  // Click toggles the popup; press-and-move drags the window.
  let start: { x: number; y: number } | null = null;

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sprite" onpointerdown={down} onpointermove={move} onpointerup={up} title="Task assistant">
  <div class="float">
    <img src={spriteUrl} alt="" draggable="false" />
  </div>
  <div class="shadow"></div>
</div>

<style>
  .sprite {
    width: 100vw;
    height: 100vh;
    display: grid;
    place-items: center;
    cursor: pointer;
    position: relative;
  }
  /* Same on-screen footprint as the original character: about 52×64 px. */
  img {
    display: block;
    width: 52px;
    height: 64px;
    pointer-events: none;
    user-select: none;
    /* Keeps the white mask readable on light desktops. */
    filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35)) drop-shadow(0 0 6px rgba(0, 0, 0, 0.12));
    transition: transform 0.2s ease;
  }
  .sprite:hover img {
    transform: scale(1.05);
  }
  /* Gentle hover: bob up and down with a slight sway, slightly out of sync so it never looks mechanical. */
  .float {
    animation: bob 3.2s ease-in-out infinite, sway 5.3s ease-in-out infinite;
    transform-origin: 50% 40%;
  }
  .shadow {
    position: absolute;
    left: 50%;
    bottom: 8px;
    width: 34px;
    height: 6px;
    margin-left: -17px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.22);
    filter: blur(2px);
    animation: shadow 3.2s ease-in-out infinite;
  }
  @keyframes bob {
    0%,
    100% {
      translate: 0 -2px;
    }
    50% {
      translate: 0 3px;
    }
  }
  @keyframes sway {
    0%,
    100% {
      rotate: -2.5deg;
    }
    50% {
      rotate: 2.5deg;
    }
  }
  /* The shadow shrinks when the mask rises, grows when it sinks. */
  @keyframes shadow {
    0%,
    100% {
      transform: scale(0.8);
      opacity: 0.6;
    }
    50% {
      transform: scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .float,
    .shadow {
      animation: none;
    }
  }
</style>
