<script lang="ts">
  import { onMount } from "svelte";
  import type { ActionError, HostToWebview, PulseState } from "../../src/shared/messages";
  import type { CommitDetails } from "../../src/shared/types";
  import Changes from "./Changes.svelte";
  import Graph from "./Graph.svelte";
  import Header from "./Header.svelte";
  import Remote from "./Remote.svelte";
  import Repos from "./Repos.svelte";
  import { preview } from "./util";
  import { send } from "./vscode";

  let state: PulseState = $state({ kind: "loading" });
  let busy: string | null = $state(null);
  let error: ActionError | null = $state(null);
  let details: CommitDetails | null = $state(null);
  let fetching = $state(false);

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (message.type === "state") state = message.state;
      else if (message.type === "busy") {
        busy = message.label;
        if (busy) error = null;
      } else if (message.type === "error") error = message.error;
      else if (message.type === "commitDetails") details = message.details;
      else if (message.type === "fetching") fetching = message.active;
    };
    window.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main>
  {#if state.kind === "loading"}
    <p class="muted pad">Reading repository…</p>
  {:else if state.kind === "no-folder"}
    <div class="empty-state">
      <p class="muted">Open a folder to see its git state.</p>
      <button class="primary" onclick={() => send({ type: "openFolder" })}>Open Folder</button>
    </div>
  {:else if state.kind === "no-repo"}
    <div class="empty-state">
      <p class="muted">This folder isn't a git repository yet.</p>
      <button class="primary" onclick={() => send({ type: "initRepo" })}>Initialize Repository</button>
      <code class="command">git init</code>
    </div>
  {:else if state.kind === "error"}
    <p class="error pad">{state.message}</p>
  {:else}
    {#if state.repos.length > 1}
      <Repos repos={state.repos} selected={state.repo.root} {busy} />
    {/if}
    <Header repo={state.repo} {busy} />
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
    {#if state.repo.operation}
      {@const repo = state.repo}
      {@const next = preview({ type: "continueOperation" }, repo)}
      {@const abort = preview({ type: "abortOperation" }, repo)}
      <div class="operation" role="status">
        <div class="operation-text">
          <span class="codicon codicon-debug-pause"></span>
          <span
            ><b>{repo.operation}</b> paused{repo.status.files.some((f) => f.conflicted)
              ? ": fix the conflicted files, then press ✓ on each to mark it resolved"
              : ": all resolved"}</span
          >
        </div>
        <div class="operation-actions">
          <button
            class="primary"
            disabled={!next.ok || !!busy}
            title={next.text}
            onclick={() => send({ type: "action", request: { type: "continueOperation" } })}
          >
            <span class="codicon codicon-debug-continue"></span>Continue
          </button>
          <button
            disabled={!abort.ok || !!busy}
            title={abort.text}
            onclick={() => send({ type: "action", request: { type: "abortOperation" } })}
          >
            <span class="codicon codicon-debug-stop"></span>Abort
          </button>
        </div>
      </div>
    {/if}
    <!-- Keyed by repo, so drafts, expanded commits and scroll don't leak between repos. -->
    {#key state.repo.root}
      <Remote repo={state.repo} {busy} {fetching} />
      <Changes repo={state.repo} {busy} />
      <Graph repo={state.repo} {busy} {details} />
    {/key}
  {/if}
</main>
