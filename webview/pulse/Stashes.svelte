<script lang="ts">
  import type { RepoState } from "../../src/shared/types";
  import { ago, preview } from "./util";
  import { loadCollapsed, saveCollapsed, send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  // Open by default while there's a fresh GitKit discard: that's when people look for it.
  const recentDiscard = $derived(repo.stashes.some((s) => s.byGitKit && Date.now() / 1000 - s.time < 15 * 60));
  let collapsed = $state(loadCollapsed("stashes", true));
  $effect(() => saveCollapsed("stashes", collapsed));
</script>

{#if repo.stashes.length}
  <section class="section stashes">
    <button class="group-header section-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
      <span>Saved changes</span><span class="count">{repo.stashes.length}</span>
      {#if collapsed && recentDiscard}
        <span class="toggle-hint">your discard is here</span>
      {/if}
    </button>

    {#if !collapsed}
      <ul class="stash-list">
        {#each repo.stashes as stash (stash.hash)}
          {@const apply = preview({ type: "stashApply", ref: stash.ref }, repo)}
          {@const pop = preview({ type: "stashPop", ref: stash.ref }, repo)}
          {@const drop = preview({ type: "stashDrop", ref: stash.ref }, repo)}
          <li class="stash" title="{stash.ref} · {new Date(stash.time * 1000).toLocaleString()}">
            <span class="codicon codicon-{stash.byGitKit ? 'trash' : 'archive'} step-icon"></span>
            <span class="step-text">
              {stash.byGitKit ? stash.message.replace(/^GitKit discard: /, "Discarded: ") : stash.message}
            </span>
            {#if stash.branch && stash.branch !== repo.status.branch}<span class="dir">on {stash.branch}</span>{/if}
            <span class="time">{ago(stash.time)}</span>
            <span class="file-actions">
              <button
                class="icon-button"
                title="Restore, keeping a copy here\n{apply.text}"
                disabled={!!busy}
                onclick={() => send({ type: "action", request: { type: "stashApply", ref: stash.ref } })}
                ><span class="codicon codicon-reply"></span></button
              >
              <button
                class="icon-button"
                title="Restore and remove from this list\n{pop.text}"
                disabled={!!busy}
                onclick={() => send({ type: "action", request: { type: "stashPop", ref: stash.ref } })}
                ><span class="codicon codicon-check"></span></button
              >
              <button
                class="icon-button"
                title="Delete for good\n{drop.text}"
                disabled={!!busy}
                onclick={() => send({ type: "action", request: { type: "stashDrop", ref: stash.ref } })}
                ><span class="codicon codicon-trash"></span></button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
