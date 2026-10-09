<script lang="ts">
  import { onMount } from "svelte";
  import { STEP_GROUPS, STEP_PRESETS, type StepPreset } from "../../src/workflow/model";

  // "Add a step": ready-made steps by group, narrowed by search (name, description or the action
  // it uses). Nothing found still leaves a way forward: any action, or any command.

  let { onpick, oncancel }: { onpick: (key: string) => void; oncancel: () => void } = $props();

  let query = $state("");
  let search: HTMLInputElement | undefined = $state();
  onMount(() => search?.focus());

  const entries = Object.entries(STEP_PRESETS);
  const matches = (p: StepPreset) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const text = `${p.label} ${p.description} ${p.steps.map((s) => s.uses ?? "").join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((word) => text.includes(word));
  };
  const found = $derived(entries.filter(([, p]) => matches(p)));
</script>

<div class="step-picker" role="group" aria-label="Choose a step to add">
  <label class="search-field">
    <span class="codicon codicon-search" aria-hidden="true"></span>
    <input
      bind:this={search}
      placeholder="Search: python, docker, cache, release…"
      aria-label="Search steps"
      bind:value={query}
    />
  </label>
  {#each STEP_GROUPS as group (group)}
    {@const items = found.filter(([, p]) => p.group === group)}
    {#if items.length}
      <h4 class="preset-group">{group}</h4>
      {#each items as [key, preset] (key)}
        <button class="preset" aria-label={preset.label} title={preset.description} onclick={() => onpick(key)}>
          <span class="codicon codicon-{preset.icon}" aria-hidden="true"></span>
          <span class="preset-text">
            <span class="preset-label">{preset.label}</span>
            <span class="preset-description">{preset.description}</span>
          </span>
        </button>
      {/each}
    {/if}
  {/each}
  {#if found.length === 0}
    <p class="field-hint">
      No ready-made step for "{query}". Any action from the Marketplace works:
      <button class="link" onclick={() => onpick("action")}>use an action</button>, or
      <button class="link" onclick={() => onpick("run")}>run a command</button>.
    </p>
  {/if}
  <button class="link" onclick={oncancel}>Cancel</button>
</div>
