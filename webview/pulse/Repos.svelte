<script lang="ts">
  import type { RepoSummary } from "../../src/shared/types";
  import { loadReposCollapsed, saveReposCollapsed, send } from "./vscode";

  let { repos, selected, busy }: { repos: RepoSummary[]; selected: string; busy: string | null } = $props();

  let collapsed = $state(loadReposCollapsed());
  $effect(() => saveReposCollapsed(collapsed));

  const current = $derived(repos.find((r) => r.root === selected));
  const needsAttention = $derived(
    repos.filter((r) => r.root !== selected && (r.conflicts || r.behind || r.error)).length,
  );
</script>

<section class="repos">
  <button class="group-header repos-toggle" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
    <span class="codicon codicon-chevron-{collapsed ? 'right' : 'down'}"></span>
    <span>Repositories</span><span class="count">{repos.length}</span>
    {#if collapsed && current}
      <span class="repos-current">{current.label}</span>
    {/if}
    {#if collapsed && needsAttention}
      <span class="repos-attention" title="{needsAttention} other repo{needsAttention === 1 ? '' : 's'} need attention"
        ><span class="codicon codicon-circle-filled"></span>{needsAttention}</span
      >
    {/if}
  </button>

  {#if !collapsed}
    <ul class="repo-list">
      {#each repos as repo (repo.root)}
        <li>
          <button
            class="repo-row"
            class:selected={repo.root === selected}
            title={repo.error ? `${repo.root}\n${repo.error}` : repo.root}
            disabled={!!busy && repo.root !== selected}
            onclick={() => send({ type: "selectRepo", root: repo.root })}
          >
            <span class="codicon codicon-repo"></span>
            <span class="repo-name">{repo.label}</span>
            <span class="repo-branch">{repo.branch ?? (repo.error ? "" : "detached")}</span>
            <span class="repo-badges">
              {#if repo.error}
                <span class="warn" title={repo.error}><span class="codicon codicon-error"></span></span>
              {:else}
                {#if repo.conflicts}
                  <span class="warn" title="{repo.conflicts} conflicted"
                    ><span class="codicon codicon-warning"></span>{repo.conflicts}</span
                  >
                {/if}
                {#if repo.ahead}<span class="out" title="{repo.ahead} to push">↑{repo.ahead}</span>{/if}
                {#if repo.behind}<span class="in" title="{repo.behind} to pull">↓{repo.behind}</span>{/if}
                {#if repo.changes}
                  <span class="changes" title="{repo.changes} changed file{repo.changes === 1 ? '' : 's'}"
                    >{repo.changes}</span
                  >
                {:else if !repo.ahead && !repo.behind}
                  <span class="clean" title="Clean"><span class="codicon codicon-check"></span></span>
                {/if}
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
