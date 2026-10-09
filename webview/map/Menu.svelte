<script lang="ts">
  import { onMount } from "svelte";
  import type { MenuItem } from "./menu";

  let {
    x,
    y,
    heading,
    items,
    onClose,
  }: { x: number; y: number; heading: string; items: MenuItem[]; onClose: () => void } = $props();

  let menu: HTMLDivElement | undefined = $state();

  onMount(() => {
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(at + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  });
</script>

<div class="menu" role="menu" aria-label={heading} bind:this={menu} style="left: {x}px; top: {y}px">
  <div class="menu-heading">{heading}</div>
  {#each items as item (item.label)}
    <button
      role="menuitem"
      disabled={item.disabled}
      title={item.title}
      onclick={() => {
        item.run();
        onClose();
      }}
    >
      <span class="codicon codicon-{item.icon}"></span>{item.label}
    </button>
  {/each}
</div>
