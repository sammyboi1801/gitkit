<script lang="ts">
  import type { RepoState, WorktreeInfo } from "../../src/shared/types";
  import { ago, worktreeLabel } from "./util";
  import { loadCollapsed, saveCollapsed, send } from "./vscode";

  // Every checkout of this repo, including ones made by the CLI or agent tools: which branch each
  // has, whether there's uncommitted work in it, and how far it is from main.

  let { repo }: { repo: RepoState } = $props();

  let collapsed = $state(loadCollapsed("worktrees", false));
  $effect(() => saveCollapsed("worktrees", collapsed));

  const mainPath = $derived(repo.worktrees.find((w) => w.main)?.path ?? repo.root);
  const base = $derived(repo.base?.name ?? "main");

  const name = (w: WorktreeInfo) =>
    w.bare ? "bare repository" : (w.branch ?? `detached at ${w.head?.slice(0, 7) ?? "?"}`);

  function details(w: WorktreeInfo): string[] {
    const parts: string[] = [];
    if (w.changes) parts.push(`${w.changes} uncommitted`);
    if (w.ahead) parts.push(`↑${w.ahead}`);
    if (w.behind) parts.push(`↓${w.behind} behind ${base}`);
    return parts;
  }

  const open = (w: WorktreeInfo, newWindow: boolean) => send({ type: "openWorktree", path: w.path, newWindow });
</script>

{#if repo.worktrees.length > 1}
  <section class="section worktrees">
    <button class="group-header section-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
      <span>Worktrees</span><span class="count">{repo.worktrees.length}</span>
    </button>

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
              </span>
            </button>
            {#if openable}
              <span class="file-actions">
                <button
                  class="icon-button"
                  title="Add to this window (it becomes a multi-folder workspace)"
                  aria-label="Add {name(w)} to this window"
                  onclick={() => open(w, false)}><span class="codicon codicon-root-folder"></span></button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
