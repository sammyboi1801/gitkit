<script lang="ts">
  import type { ActionRequest } from "../../src/git/actions";
  import type { RepoState } from "../../src/shared/types";
  import { preview, suggestedSync, summarize } from "./util";
  import { send } from "./vscode";

  let { repo, busy }: { repo: RepoState; busy: string | null } = $props();

  const status = $derived(repo.status);
  const pull = $derived(preview({ type: "pull" }, repo));
  const push = $derived(preview({ type: "push" }, repo));
  const sync = $derived(preview({ type: "sync" }, repo));
  const summary = $derived(summarize(repo));

  // Highlight the one action that makes sense right now.
  const primary = $derived(suggestedSync(repo));

  const run = (request: ActionRequest) => send({ type: "action", request });
</script>

<header class="header">
  <div class="title-row">
    <button class="branch-button" title="Switch branch" disabled={!!busy} onclick={() => send({ type: "pickBranch" })}>
      <span class="codicon codicon-git-branch accent"></span>
      <span class="branch">{status.branch ?? `detached @ ${status.oid?.slice(0, 7) ?? "?"}`}</span>
      <span class="codicon codicon-chevron-down chevron"></span>
    </button>
    <button
      class="oops-button"
      aria-label="Oops"
      title="Fix a mistake: undo a commit, recover a branch, get back discarded work…"
      disabled={!!busy}
      onclick={() => send({ type: "oops" })}
    >
      <span class="codicon codicon-lightbulb-sparkle"></span><span class="label">Oops</span>
    </button>
  </div>

  <p class="summary tone-{summary.tone}">
    <span class="codicon codicon-{summary.icon}"></span>
    <span>{summary.text}</span>
    {#if repo.stashes.length > 0}
      <span class="chip" title="Saved stashes, including anything GitKit discarded"
        ><span class="codicon codicon-archive"></span>{repo.stashes.length}</span
      >
    {/if}
  </p>

  <div class="actions">
    <button
      class:primary={primary === "pull"}
      aria-label="Pull"
      disabled={!pull.ok || !!busy}
      title={pull.text}
      onclick={() => run({ type: "pull" })}
    >
      <span class="codicon codicon-cloud-download"></span><span class="label">Pull</span>{#if status.behind}<span
          class="count-pill">{status.behind}</span
        >{/if}
    </button>
    <button
      class:primary={primary === "push"}
      aria-label={push.label || "Push"}
      disabled={!push.ok || !!busy}
      title={push.text}
      onclick={() => run({ type: "push" })}
    >
      <span class="codicon codicon-cloud-upload"></span><span class="label">{push.label || "Push"}</span
      >{#if status.ahead}<span class="count-pill">{status.ahead}</span>{/if}
    </button>
    <button
      class:primary={primary === "sync"}
      aria-label="Sync"
      disabled={!sync.ok || !!busy}
      title={sync.text}
      onclick={() => run({ type: "sync" })}
    >
      <span class="codicon codicon-sync" class:spin={busy === "Sync"}></span><span class="label">Sync</span>
    </button>
  </div>
</header>
