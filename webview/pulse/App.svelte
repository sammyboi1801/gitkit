<script lang="ts">
  import { onMount } from "svelte";
  import type { ActionError, HostToWebview, PulseState } from "../../src/shared/messages";
  import type { CommitDetails, ConflictBlock } from "../../src/shared/types";
  import Changes from "./Changes.svelte";
  import Graph from "./Graph.svelte";
  import Header from "./Header.svelte";
  import History from "./History.svelte";
  import Stashes from "./Stashes.svelte";
  import Worktrees from "./Worktrees.svelte";
  import Remote from "./Remote.svelte";
  import Repos from "./Repos.svelte";
  import { applyMainColor } from "../shared/graph";
  import { preview } from "./util";
  import { send } from "./vscode";

  let view = $state<PulseState>({ kind: "loading" });
  let busy: string | null = $state(null);
  let error: ActionError | null = $state(null);
  let details: CommitDetails | null = $state(null);
  let fetching = $state(false);
  let conflictBlocks: Record<string, ConflictBlock[]> = $state({});

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (message.type === "state") view = message.state;
      else if (message.type === "busy") {
        busy = message.label;
        if (busy) error = null;
      } else if (message.type === "error") error = message.error;
      else if (message.type === "commitDetails") details = message.details;
      else if (message.type === "fetching") fetching = message.active;
      else if (message.type === "config") applyMainColor(message.mainBranchColor);
      else if (message.type === "conflictDetails")
        conflictBlocks = { ...conflictBlocks, [message.path]: message.blocks };
    };
    window.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main>
  {#if view.kind === "loading"}
    <p class="muted pad">Reading repository…</p>
  {:else if view.kind === "no-folder"}
    <div class="empty-state">
      <p class="muted">Open a folder to see its git state.</p>
      <button class="primary" onclick={() => send({ type: "openFolder" })}>Open Folder</button>
    </div>
  {:else if view.kind === "no-repo"}
    <div class="empty-state">
      <p class="muted">This folder isn't a git repository yet.</p>
      <button class="primary" onclick={() => send({ type: "initRepo" })}>Initialize Repository</button>
      <code class="command">git init</code>
    </div>
  {:else if view.kind === "error"}
    <p class="error pad">{view.message}</p>
  {:else}
    {#if view.repos.length > 1}
      <Repos repos={view.repos} selected={view.repo.root} {busy} />
    {/if}
    <Header repo={view.repo} {busy} />
    {#if busy}
      <div class="progress" aria-label="{busy} in progress"></div>
    {/if}
    {#if error}
      <div class="banner" role="alert">
        <span class="codicon codicon-error"></span>
        <div class="banner-body">
          <p>{error.message}</p>
          {#if error.command}<code class="command">{error.command}</code>{/if}
        </div>
        <button class="icon-button" title="Dismiss" onclick={() => (error = null)}>
          <span class="codicon codicon-close"></span>
        </button>
      </div>
    {/if}
    {#if view.repo.operation}
      {@const repo = view.repo}
      {@const next = preview({ type: "continueOperation" }, repo)}
      {@const abort = preview({ type: "abortOperation" }, repo)}
      {@const left = repo.status.files.filter((f) => f.conflicted).length}
      <div class="operation" role="status">
        <div class="operation-text">
          <span class="codicon codicon-debug-pause"></span>
          <span>
            {#if left}
              <b>{repo.operation}</b> paused: {left === 1 ? "1 file has" : `${left} files have`} conflicts. Choose what to
              keep below, then Continue.
            {:else}
              <b>{repo.operation}</b> paused: no conflicts left. Continue to finish.
            {/if}
          </span>
        </div>
        <div class="operation-actions">
          <button
            class="primary"
            disabled={!next.ok || !!busy}
            aria-label={left ? `Continue (${left} left)` : "Continue"}
            title={next.text}
            onclick={() => send({ type: "action", request: { type: "continueOperation" } })}
          >
            <span class="codicon codicon-debug-continue"></span><span class="label">Continue</span>
            <!-- A count instead of "(1 left)", which a narrow sidebar cuts off. -->
            {#if left}<span class="left-pill" aria-hidden="true">{left}</span>{/if}
          </button>
          <button
            disabled={!abort.ok || !!busy}
            aria-label="Abort"
            title={abort.text}
            onclick={() => send({ type: "action", request: { type: "abortOperation" } })}
          >
            <span class="codicon codicon-debug-stop"></span><span class="label">Abort</span>
          </button>
        </div>
      </div>
    {/if}
    <!-- Keyed by repo, so drafts, expanded commits and scroll don't leak between repos. -->
    {#key view.repo.root}
      <!-- Mid-merge, the conflicts are the job at hand: they come first, right under the banner. -->
      {#if view.repo.operation}
        <Changes repo={view.repo} {busy} {conflictBlocks} />
        <Remote repo={view.repo} {busy} {fetching} />
      {:else}
        <Remote repo={view.repo} {busy} {fetching} />
        <Changes repo={view.repo} {busy} {conflictBlocks} />
      {/if}
      <Worktrees repo={view.repo} {busy} />
      <Stashes repo={view.repo} {busy} />
      <History repo={view.repo} {busy} />
      <Graph repo={view.repo} {busy} {details} />
    {/key}
  {/if}
</main>
