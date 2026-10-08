<script lang="ts">
  import type { ActionRequest } from "../../src/git/actions";
  import type { RepoState } from "../../src/shared/types";
  import { preview, summarize } from "./util";
  import { send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  const status = $derived(repo.status);
  const pull = $derived(preview({ type: "pull" }, repo));
  const push = $derived(preview({ type: "push" }, repo));
  const sync = $derived(preview({ type: "sync" }, repo));
  const summary = $derived(summarize(repo));

  // Highlight the one action that makes sense right now.
  const primary = $derived.by(() => {
    if (!status.branch || repo.remotes.length === 0) return null;
    if (!status.upstream) return "push";
    if (status.ahead && status.behind) return "sync";
    if (status.behind) return "pull";
    if (status.ahead) return "push";
    return null;
  });

  const run = (request: ActionRequest) => send({ type: "action", request });
</script>

<header class="header">
  <div class="title-row">
    <button class="branch-button" title="Switch branch" disabled={!!busy} onclick={() => send({ type: "pickBranch" })}>
      <span class="codicon codicon-git-branch accent"></span>
      <span class="branch">{status.branch ?? `detached @ ${status.oid?.slice(0, 7) ?? "?"}`}</span>
      <span class="codicon codicon-chevron-down chevron"></span>
    </button>
  </div>

  <p class="summary tone-{summary.tone}">
    <span class="codicon codicon-{summary.icon}"></span>
    <span>{summary.text}</span>
    {#if repo.stashCount > 0}
      <span class="chip" title="Saved stashes, including anything GitKit discarded"
        ><span class="codicon codicon-archive"></span>{repo.stashCount}</span
      >
    {/if}
  </p>

  <div class="actions">
    <button
      class:primary={primary === "pull"}
      disabled={!pull.ok || !!busy}
      title={pull.text}
      onclick={() => run({ type: "pull" })}
    >
      <span class="codicon codicon-cloud-download"></span>Pull{#if status.behind}<span class="count-pill"
          >{status.behind}</span
        >{/if}
    </button>
    <button
      class:primary={primary === "push"}
      disabled={!push.ok || !!busy}
      title={push.text}
      onclick={() => run({ type: "push" })}
    >
      <span class="codicon codicon-cloud-upload"></span>{push.label || "Push"}{#if status.ahead}<span class="count-pill"
          >{status.ahead}</span
        >{/if}
    </button>
    <button
      class:primary={primary === "sync"}
      disabled={!sync.ok || !!busy}
      title={sync.text}
      onclick={() => run({ type: "sync" })}
    >
      <span class="codicon codicon-sync" class:spin={busy === "Sync"}></span>Sync
    </button>
  </div>
</header>
