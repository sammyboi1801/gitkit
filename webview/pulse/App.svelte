<script lang="ts">
  import { onMount } from "svelte";
  import type { ActionError, HostToWebview, PulseState } from "../../src/shared/messages";
  import type { CommitDetails } from "../../src/shared/types";
  import Changes from "./Changes.svelte";
  import Graph from "./Graph.svelte";
  import Header from "./Header.svelte";
  import { send } from "./vscode";

  let state: PulseState = $state({ kind: "loading" });
  let busy: string | null = $state(null);
  let error: ActionError | null = $state(null);
  let details: CommitDetails | null = $state(null);

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (message.type === "state") state = message.state;
      else if (message.type === "busy") {
        busy = message.label;
        if (busy) error = null;
      } else if (message.type === "error") error = message.error;
      else if (message.type === "commitDetails") details = message.details;
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
    <Changes repo={state.repo} {busy} />
    <Graph repo={state.repo} {busy} {details} />
  {/if}
</main>
