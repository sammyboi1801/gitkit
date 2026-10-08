<script lang="ts">
  import { onMount } from "svelte";
  import type { HostToWebview, PulseState } from "../../src/shared/messages";

  const vscode = acquireVsCodeApi();
  let state: PulseState = $state({ kind: "loading" });

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      if (event.data.type === "state") state = event.data.state;
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main>
  {#if state.kind === "loading"}
    <p class="muted">Reading repository…</p>
  {:else if state.kind === "no-folder"}
    <p class="muted">Open a folder to see its git state.</p>
  {:else if state.kind === "no-repo"}
    <p class="muted">This folder isn't a git repository yet.</p>
  {:else if state.kind === "error"}
    <p class="error">{state.message}</p>
  {:else}
    <section class="card">
      <div class="branch">
        <span class="glyph">⎇</span>
        <span>{state.branch}</span>
      </div>
      <code class="command" title="The command GitKit ran">{state.command}</code>
    </section>
  {/if}
</main>
