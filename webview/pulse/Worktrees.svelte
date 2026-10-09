<script lang="ts">
  import type { RepoState, WorktreeInfo } from "../../src/shared/types";
  import { ago, overlapNotes, preview, worktreeLabel, worktreeName as name } from "./util";
  import { loadCollapsed, saveCollapsed, send } from "./vscode";

  // Every checkout of this repo, including ones made by the CLI or agent tools: which branch each
  // has, whether there's uncommitted work in it, and how far it is from main.

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  let collapsed = $state(loadCollapsed("worktrees", false));
  $effect(() => saveCollapsed("worktrees", collapsed));

  const mainPath = $derived(repo.worktrees.find((w) => w.main)?.path ?? repo.root);
  const base = $derived(repo.base?.name ?? "main");

  function details(w: WorktreeInfo): string[] {
    const parts: string[] = [];
    if (w.changes) parts.push(`${w.changes} uncommitted`);
    if (w.ahead) parts.push(`↑${w.ahead}`);
    if (w.behind) parts.push(`↓${w.behind} behind ${base}`);
    return parts;
  }

  const open = (w: WorktreeInfo, newWindow: boolean) => send({ type: "openWorktree", path: w.path, newWindow });
  const prune = $derived(preview({ type: "pruneWorktrees" }, repo));
  const missing = $derived(repo.worktrees.filter((w) => w.prunable !== null).length);
</script>

{#if repo.worktrees.length > 1}
  <section class="section worktrees">
    <div class="worktrees-header">
      <button class="group-header section-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
        <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
        <span>Worktrees</span><span class="count">{repo.worktrees.length}</span>
      </button>
      {#if missing}
        <button
          class="small-button"
          title={`Forget the ${missing} worktree${missing === 1 ? "" : "s"} whose folder is gone\n${prune.text}`}
          disabled={!prune.ok || !!busy}
          onclick={() => send({ type: "action", request: { type: "pruneWorktrees" } })}>Clean up</button
        >
      {/if}
      <button
        class="icon-button"
        title="New worktree: work on a branch in its own folder"
        aria-label="New worktree"
        disabled={!!busy}
        onclick={() => send({ type: "newWorktree" })}><span class="codicon codicon-add"></span></button
      >
    </div>

    {#if !collapsed}
      <ul class="worktree-list" aria-label="Worktrees">
        {#each repo.worktrees as w (w.path)}
          {@const label = worktreeLabel(w.path, mainPath)}
          {@const openable = !w.current && w.prunable === null && !w.bare}
          <li class="worktree" class:current={w.current} class:missing={w.prunable !== null}>
            <button
              class="worktree-open"
              disabled={!openable}
              title={openable ? `Open in a new window\n${w.path}` : w.path}
              onclick={() => open(w, true)}
            >
              <span
                class="codicon codicon-{w.current
                  ? 'folder-active'
                  : w.prunable !== null
                    ? 'folder'
                    : 'folder-opened'} row-icon"
                aria-hidden="true"
              ></span>
              <span class="worktree-text">
                <span class="worktree-name">
                  <span class="branch-name">{name(w)}</span>
                  {#if w.current}<span class="tag">this window</span>{/if}
                  {#if w.main && !w.current}<span class="tag">main checkout</span>{/if}
                  {#if w.locked !== null}
                    <span class="codicon codicon-lock" title={w.locked ? `Locked: ${w.locked}` : "Locked"}></span>
                  {/if}
                </span>
                <span class="worktree-meta">
                  {#if w.prunable !== null}
                    <span class="warn">folder is gone</span>
                  {:else}
                    <span class="dir">{label}</span>
                    {#each details(w) as part (part)}<span>{part}</span>{/each}
                    {#if w.lastActivity}<span class="time">{ago(w.lastActivity)}</span>{/if}
                  {/if}
                </span>
                {#each overlapNotes(w.path, repo) as note (note.text)}
                  <span class="worktree-note {note.tone}">
                    <span class="codicon codicon-{note.tone === 'conflict' ? 'error' : 'warning'}" aria-hidden="true"
                    ></span>{note.text}
                  </span>
                {/each}
              </span>
            </button>
            {#if openable}
              {@const remove = preview({ type: "removeWorktree", path: w.path }, repo)}
              {@const lock = preview(
                { type: w.locked === null ? "lockWorktree" : "unlockWorktree", path: w.path },
                repo,
              )}
              <span class="file-actions">
                <button
                  class="icon-button"
                  title="Add to this window (it becomes a multi-folder workspace)"
                  aria-label="Add {name(w)} to this window"
                  onclick={() => open(w, false)}><span class="codicon codicon-root-folder"></span></button
                >
                <button
                  class="icon-button"
                  title={`${w.locked === null ? "Lock, so it can't be removed or cleaned up by accident" : "Unlock"}\n${lock.text}`}
                  aria-label="{w.locked === null ? 'Lock' : 'Unlock'} {name(w)}"
                  disabled={!lock.ok || !!busy}
                  onclick={() =>
                    send({
                      type: "action",
                      request: { type: w.locked === null ? "lockWorktree" : "unlockWorktree", path: w.path },
                    })}><span class="codicon codicon-{w.locked === null ? 'lock' : 'unlock'}"></span></button
                >
                <button
                  class="icon-button"
                  title={remove.ok ? `Remove this worktree (its branch stays)\n${remove.text}` : remove.text}
                  aria-label="Remove {name(w)}"
                  disabled={!remove.ok || !!busy}
                  onclick={() => send({ type: "action", request: { type: "removeWorktree", path: w.path } })}
                  ><span class="codicon codicon-trash"></span></button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
