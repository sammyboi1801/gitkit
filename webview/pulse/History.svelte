<script lang="ts">
  import { undoableCount } from "../../src/git/history";
  import type { Checkpoint, HistoryEntry, RepoState } from "../../src/shared/types";
  import { ago, preview } from "./util";
  import { loadCollapsed, saveCollapsed, send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  const SHOWN = 8;
  let collapsed = $state(loadCollapsed("history", true));
  $effect(() => saveCollapsed("history", collapsed));

  const CHECKPOINTS_SHOWN = 5;
  /** A removed worktree's checkpoint comes back as a branch, since its folder is gone. */
  const recoveredName = (c: Checkpoint) => {
    const d = new Date(c.time * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `checkpoint/${c.worktree}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };
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

{#if repo.history.length || repo.checkpoints.length || repo.removedCheckpoints.length}
  <section class="section history">
    <div class="section-header-row">
      <button class="group-header section-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
        <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
        <span>Undo</span>
        {#if collapsed && latest}
          <span class="toggle-hint" title={latest.summary}>last: {latest.summary}</span>
        {/if}
      </button>
      <!-- Words, not a floppy disk: "save" alone doesn't say what gets saved. -->
      <button
        class="small-button checkpoint-button"
        title="Save a checkpoint: a snapshot of every file here, new ones included, to come back to. Your files, staging area and stashes aren't touched."
        aria-label="Save checkpoint"
        disabled={!!busy}
        onclick={() => send({ type: "checkpoint" })}><span class="codicon codicon-bookmark"></span>Checkpoint</button
      >
    </div>

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

      {#if repo.checkpoints.length}
        <h4 class="subheading">Checkpoints</h4>
        <ol class="timeline" aria-label="Checkpoints">
          {#each repo.checkpoints.slice(0, CHECKPOINTS_SHOWN) as c (c.ref)}
            {@const restore = preview({ type: "restoreCheckpoint", hash: c.hash }, repo)}
            <li class="step" title="{c.reason} · {new Date(c.time * 1000).toLocaleString()} · {c.hash.slice(0, 7)}">
              <span class="codicon codicon-bookmark step-icon"></span>
              <span class="step-text">{c.reason}</span>
              <span class="time">{ago(c.time)}</span>
              <button
                class="icon-button step-undo"
                aria-label="Restore the checkpoint {c.reason}"
                title={restore.ok ? `Bring the files back to this checkpoint\n${restore.text}` : restore.text}
                disabled={!restore.ok || !!busy}
                onclick={() => send({ type: "action", request: { type: "restoreCheckpoint", hash: c.hash } })}
              >
                <span class="codicon codicon-discard"></span>
              </button>
            </li>
          {/each}
        </ol>
        {#if repo.checkpoints.length > CHECKPOINTS_SHOWN}
          <p class="hint timeline-hint">and {repo.checkpoints.length - CHECKPOINTS_SHOWN} older</p>
        {/if}
      {/if}

      {#if repo.removedCheckpoints.length}
        <h4 class="subheading">From removed worktrees</h4>
        <ol class="timeline" aria-label="Checkpoints from removed worktrees">
          {#each repo.removedCheckpoints.slice(0, CHECKPOINTS_SHOWN) as c (c.ref)}
            {@const name = recoveredName(c)}
            {@const recover = preview({ type: "recoverBranch", name, hash: c.hash }, repo)}
            <li class="step" title="{c.worktree}: {c.reason} · {new Date(c.time * 1000).toLocaleString()}">
              <span class="codicon codicon-bookmark step-icon"></span>
              <span class="step-text">{c.worktree}: {c.reason}</span>
              <span class="time">{ago(c.time)}</span>
              <button
                class="icon-button step-undo"
                aria-label="Recover {c.worktree} as a branch"
                title={recover.ok ? `Recover its files as the branch ${name}\n${recover.text}` : recover.text}
                disabled={!recover.ok || !!busy}
                onclick={() => send({ type: "action", request: { type: "recoverBranch", name, hash: c.hash } })}
              >
                <span class="codicon codicon-git-branch"></span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    {/if}
  </section>
{/if}
