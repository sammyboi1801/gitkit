<script lang="ts">
  import type { Commit, CommitDetails, RepoState } from "../../src/shared/types";
  import { headAncestors, preview, splitPath } from "../pulse/util";
  import type { WebviewToHost } from "../../src/shared/messages";

  let {
    repo,
    commit,
    details,
    busy,
    send,
    onClose,
  }: {
    repo: RepoState;
    commit: Commit;
    details: CommitDetails | null;
    busy: string | null;
    send: (message: WebviewToHost) => void;
    onClose: () => void;
  } = $props();

  const loaded = $derived(details?.hash === commit.hash ? details : null);
  const onHead = $derived(headAncestors(repo).has(commit.hash));
  const revert = $derived(preview({ type: "revert", hash: commit.hash }, repo));
  const pick = $derived(preview({ type: "cherryPick", hash: commit.hash }, repo));
</script>

<div class="commit-panel">
  <div class="panel-head">
    <span class="panel-subject" title={commit.subject}>{commit.subject}</span>
    <button class="icon-button" title="Close" onclick={onClose}><span class="codicon codicon-close"></span></button>
  </div>
  <div class="meta">
    <span>{commit.author}</span>
    <span class="muted">{new Date(commit.time * 1000).toLocaleString()}</span>
  </div>
  {#if loaded}
    {#if loaded.body !== commit.subject}
      <p class="body">{loaded.body}</p>
    {/if}
    <ul class="detail-files">
      {#each loaded.files as file (file.path)}
        {@const { name, dir } = splitPath(file.path)}
        <li title={file.path}>
          <span class="name">{name}</span>
          {#if dir}<span class="dir">{dir}</span>{/if}
          <span class="stats">
            {#if file.stats.binary}<span class="muted">bin</span>{:else}
              {#if file.stats.added}<span class="stat-add">+{file.stats.added}</span>{/if}
              {#if file.stats.removed}<span class="stat-del">−{file.stats.removed}</span>{/if}
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Loading…</p>
  {/if}
  <div class="detail-actions">
    <button title="Copy {commit.hash}" onclick={() => send({ type: "copyHash", hash: commit.hash })}>
      <span class="codicon codicon-copy"></span>{commit.hash.slice(0, 7)}
    </button>
    <button
      title="git switch -c <name> {commit.hash.slice(0, 7)}"
      disabled={!!busy}
      onclick={() => send({ type: "branchFrom", hash: commit.hash })}
    >
      <span class="codicon codicon-git-branch-create"></span>Branch here
    </button>
    {#if onHead}
      <button
        title={revert.text}
        disabled={!revert.ok || !!busy}
        onclick={() => send({ type: "action", request: { type: "revert", hash: commit.hash } })}
      >
        <span class="codicon codicon-discard"></span>Revert
      </button>
    {:else}
      <button
        title={pick.text}
        disabled={!pick.ok || !!busy}
        onclick={() => send({ type: "action", request: { type: "cherryPick", hash: commit.hash } })}
      >
        <span class="codicon codicon-git-pull-request-go-to-changes"></span>Cherry-pick
      </button>
    {/if}
  </div>
</div>
