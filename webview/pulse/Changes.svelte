<script lang="ts">
  import { untrack } from "svelte";
  import type { FileChange, LineStats, RepoState } from "../../src/shared/types";
  import { badge, preview, splitPath, totals } from "./util";
  import { loadDraft, saveDraft, send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  // The parent remounts this per repo, so the root is fixed for this instance's lifetime.
  const root = untrack(() => repo.root);
  let message = $state(loadDraft(root));
  $effect(() => saveDraft(root, message));

  const files = $derived(repo.status.files);
  const conflicts = $derived(files.filter((f) => f.conflicted));
  const staged = $derived(files.filter((f) => !f.conflicted && f.index));
  const unstaged = $derived(files.filter((f) => !f.conflicted && (f.worktree || f.untracked)));
  const commit = $derived(preview({ type: "commit", message: message || "…" }, repo));
  const canCommit = $derived(commit.ok && message.trim().length > 0 && !busy);

  const stage = (paths: string[]) => send({ type: "action", request: { type: "stage", paths } });
  const unstage = (paths: string[]) => send({ type: "action", request: { type: "unstage", paths } });
  const discard = (paths: string[]) => send({ type: "action", request: { type: "discard", paths } });
  const paths = (list: FileChange[]) => list.map((f) => f.path);
  const stagedTotal = $derived(totals(staged.map((f) => f.indexStats)));
  const unstagedTotal = $derived(totals(unstaged.map((f) => f.worktreeStats)));

  function submit() {
    if (!canCommit) return;
    send({ type: "action", request: { type: "commit", message } });
    message = "";
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
  }
</script>

{#snippet groupTotal(total: { added: number; removed: number })}
  {#if total.added || total.removed}
    <span class="group-stats"
      >{#if total.added}<span class="stat-add">+{total.added}</span>{/if}
      {#if total.removed}<span class="stat-del">−{total.removed}</span>{/if}</span
    >
  {/if}
{/snippet}

{#snippet lineStats(stats: LineStats | undefined, untracked = false)}
  {#if untracked}
    <span class="stats"><span class="stat-new">new</span></span>
  {:else if stats?.binary}
    <span class="stats muted">bin</span>
  {:else if stats && (stats.added || stats.removed)}
    {@const total = stats.added + stats.removed}
    {@const green = Math.round((stats.added / total) * 5)}
    <span class="stats" title="{stats.added} added, {stats.removed} removed">
      {#if stats.added}<span class="stat-add">+{stats.added}</span>{/if}
      {#if stats.removed}<span class="stat-del">−{stats.removed}</span>{/if}
      <span class="stat-bar"
        >{#each [0, 1, 2, 3, 4] as i (i)}<i class={i < green ? "add" : "del"}></i>{/each}</span
      >
    </span>
  {/if}
{/snippet}

{#snippet fileRow(file: FileChange, side: "staged" | "unstaged" | "conflict")}
  {@const { name, dir } = splitPath(file.path)}
  {@const mark = badge(side === "staged" ? file.index : file.worktree, side === "unstaged" && file.untracked)}
  <li class="file">
    <button
      class="file-name"
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      onclick={() => send({ type: "openFile", path: file.path })}
    >
      <span class="name tone-{mark.tone}">{name}</span>
      {#if dir}<span class="dir">{dir}</span>{/if}
    </button>
    <span class="file-actions">
      {#if side === "conflict"}
        <button
          class="icon-button"
          title={`Mark resolved: ${preview({ type: "stage", paths: [file.path] }, repo).text}`}
          disabled={!!busy}
          onclick={() => stage([file.path])}
        >
          <span class="codicon codicon-check"></span>
        </button>
      {:else if side === "staged"}
        <button
          class="icon-button"
          title={preview({ type: "unstage", paths: [file.path] }, repo).text}
          disabled={!!busy}
          onclick={() => unstage([file.path])}
        >
          <span class="codicon codicon-remove"></span>
        </button>
      {:else}
        <button
          class="icon-button"
          title={preview({ type: "discard", paths: [file.path] }, repo).text}
          disabled={!!busy}
          onclick={() => discard([file.path])}
        >
          <span class="codicon codicon-discard"></span>
        </button>
        <button
          class="icon-button"
          title={preview({ type: "stage", paths: [file.path] }, repo).text}
          disabled={!!busy}
          onclick={() => stage([file.path])}
        >
          <span class="codicon codicon-add"></span>
        </button>
      {/if}
    </span>
    {@render lineStats(side === "staged" ? file.indexStats : file.worktreeStats, side === "unstaged" && file.untracked)}
    <span class="badge tone-{mark.tone}">{mark.text}</span>
  </li>
{/snippet}

<section class="section">
  <div class="commit-box">
    <textarea
      rows="2"
      placeholder={unstaged.length && !staged.length ? "Message (commits all changes)" : "Message"}
      bind:value={message}
      onkeydown={onKeydown}></textarea>
    <button class="primary wide" disabled={!canCommit} onclick={submit} title="Ctrl+Enter">
      <span class="codicon codicon-check"></span>{commit.label || "Commit"}
    </button>
    {#if message.trim()}
      <code class="command">{commit.text}</code>
    {:else if files.length}
      <span class="hint">Ctrl+Enter to commit</span>
    {/if}
  </div>

  {#if files.length === 0}
    <p class="muted empty">No changes. Working tree is clean.</p>
  {/if}

  {#if conflicts.length}
    <div class="group-header"><span>Conflicts</span><span class="count">{conflicts.length}</span></div>
    <ul class="files">
      {#each conflicts as file (file.path)}{@render fileRow(file, "conflict")}{/each}
    </ul>
  {/if}

  {#if staged.length}
    <div class="group-header">
      <span>Staged</span><span class="count">{staged.length}</span>
      {@render groupTotal(stagedTotal)}
      <button
        class="icon-button"
        title={preview({ type: "unstage", paths: paths(staged) }, repo).text}
        disabled={!!busy}
        onclick={() => unstage(paths(staged))}
      >
        <span class="codicon codicon-remove"></span>
      </button>
    </div>
    <ul class="files">
      {#each staged as file (file.path)}{@render fileRow(file, "staged")}{/each}
    </ul>
  {/if}

  {#if unstaged.length}
    <div class="group-header">
      <span>Changes</span><span class="count">{unstaged.length}</span>
      {@render groupTotal(unstagedTotal)}
      <button
        class="icon-button"
        title={preview({ type: "stage", paths: paths(unstaged) }, repo).text}
        disabled={!!busy}
        onclick={() => stage(paths(unstaged))}
      >
        <span class="codicon codicon-add"></span>
      </button>
    </div>
    <ul class="files">
      {#each unstaged as file (file.path)}{@render fileRow(file, "unstaged")}{/each}
    </ul>
  {/if}
</section>
