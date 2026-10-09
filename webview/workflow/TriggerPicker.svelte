<script lang="ts">
  import { onMount } from "svelte";
  import { EVENTS, EVENT_GROUPS, type EventSpec } from "../../src/workflow/events";

  // "Add a trigger": the usual ones first, then every event GitHub has, grouped and searchable.

  let {
    onpick,
    oncancel,
    used,
    hasTags,
  }: {
    /** An event name, or "version-tags" for a tag filter on push. */
    onpick: (choice: string) => void;
    oncancel: () => void;
    used: string[];
    hasTags: boolean;
  } = $props();

  const COMMON = ["push", "pull_request", "schedule", "workflow_dispatch"];
  let query = $state("");
  let search: HTMLInputElement | undefined = $state();
  onMount(() => search?.focus());

  const matches = (e: EventSpec) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const text = `${e.label} ${e.description} ${e.event.replace(/_/g, " ")} ${e.group}`.toLowerCase();
    return q.split(/\s+/).every((word) => text.includes(word));
  };
  const available = $derived(EVENTS.filter((e) => !used.includes(e.event) && matches(e)));
  const showTags = $derived(!hasTags && (!query.trim() || "version tag release".includes(query.trim().toLowerCase())));
</script>

<div class="trigger-picker" role="group" aria-label="Add a trigger">
  <label class="search-field">
    <span class="codicon codicon-search" aria-hidden="true"></span>
    <input
      bind:this={search}
      placeholder="Search: release, issue, comment, other workflow…"
      aria-label="Search triggers"
      bind:value={query}
    />
  </label>
  {#if !query.trim()}
    <div class="trigger-options">
      {#each COMMON.filter((c) => !used.includes(c)) as event (event)}
        {@const spec = EVENTS.find((e) => e.event === event)!}
        <button class="option" onclick={() => onpick(event)}>
          <span class="codicon codicon-{spec.icon}" aria-hidden="true"></span>{spec.label}
        </button>
      {/each}
      {#if showTags}
        <button class="option" onclick={() => onpick("version-tags")}>
          <span class="codicon codicon-tag" aria-hidden="true"></span>When a version tag is pushed
        </button>
      {/if}
    </div>
  {/if}
  <div class="event-list">
    {#if query.trim() && showTags}
      <button class="preset" aria-label="When a version tag is pushed" onclick={() => onpick("version-tags")}>
        <span class="codicon codicon-tag" aria-hidden="true"></span>
        <span class="preset-text">
          <span class="preset-label">When a version tag is pushed</span>
          <span class="preset-description">Like v1.2.0: the usual way to release.</span>
        </span>
      </button>
    {/if}
    {#each EVENT_GROUPS as group (group)}
      {@const items = available.filter((e) => e.group === group && (query.trim() || !COMMON.includes(e.event)))}
      {#if items.length}
        <h4 class="preset-group">{group}</h4>
        {#each items as spec (spec.event)}
          <button class="preset" aria-label={spec.label} title={spec.event} onclick={() => onpick(spec.event)}>
            <span class="codicon codicon-{spec.icon}" aria-hidden="true"></span>
            <span class="preset-text">
              <span class="preset-label">{spec.label}</span>
              <span class="preset-description">{spec.description}</span>
            </span>
          </button>
        {/each}
      {/if}
    {/each}
    {#if available.length === 0 && !showTags}
      <p class="field-hint">Nothing matches "{query}". Every GitHub event is listed here, by what it does.</p>
    {/if}
  </div>
  <button class="link" onclick={oncancel}>Cancel</button>
</div>
