<script lang="ts">
  import { undoableCount } from "../../src/git/history";
  import type { HistoryEntry, RepoState } from "../../src/shared/types";
  import { ago, preview } from "./util";
  import { loadCollapsed, saveCollapsed, send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  const SHOWN = 8;
  let collapsed = $state(loadCollapsed("history", true));
  $effect(() => saveCollapsed("history", collapsed));

  const limit = $derived(undoableCount(repo.history));
  const latest = $derived(repo.history[0]);

  const icons: Record<HistoryEntry["kind"], string> = {
    commit: "git-commit",
    amend: "edit",
    checkout: "arrow-swap",
    merge: "git-merge",
    pull: "cloud-download",
    rebase: "git-pull-request",
    reset: "debug-step-back",
    "cherry-pick": "git-pull-request-go-to-changes",
    revert: "discard",
    other: "circle-small",
  };
</script>

{#if repo.history.length}
  <section class="section history">
    <button class="group-header section-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
      <span>Undo</span>
      {#if collapsed && latest}
        <span class="toggle-hint" title={latest.summary}>last: {latest.summary}</span>
      {/if}
    </button>

    {#if !collapsed}
      <ol class="timeline">
        {#each repo.history.slice(0, SHOWN) as entry, i (entry.hash + entry.time + i)}
          {@const undo = preview({ type: "undoTo", index: i }, repo)}
          <li class="step" class:elsewhere={i >= limit}>
            <span class="codicon codicon-{icons[entry.kind]} step-icon"></span>
            <span class="step-text" title={entry.summary}>{entry.summary}</span>
            <span class="time">{ago(entry.time)}</span>
            {#if i < limit}
              <button
                class="icon-button step-undo"
                title={undo.ok
                  ? `${i === 0 ? "Undo this" : `Go back to before this (undoes ${i + 1} steps)`}\n${undo.text}`
                  : undo.text}
                disabled={!undo.ok || !!busy}
                onclick={() => send({ type: "action", request: { type: "undoTo", index: i } })}
              >
                <span class="codicon codicon-discard"></span>
              </button>
            {/if}
          </li>
        {/each}
      </ol>
      {#if limit < Math.min(repo.history.length, SHOWN)}
        <p class="hint timeline-hint">Greyed steps happened on another branch.</p>
      {/if}
    {/if}
  </section>
{/if}
