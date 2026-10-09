<script lang="ts">
  import type { ActionRequest } from "../../src/git/actions";
  import type { RepoState } from "../../src/shared/types";
  import { ago, preview, suggestedSync } from "../pulse/util";
  import { send } from "../pulse/vscode";

  // The remote at a glance, above the map: this branch vs its remote copy, vs main (with a
  // conflict forecast), CI for the last push, and when GitKit last checked.

  let { repo, busy, fetching }: { repo: RepoState; busy: string | null; fetching: boolean } = $props();

  const status = $derived(repo.status);
  const base = $derived(repo.base && !repo.base.isCurrent ? repo.base : null);
  const next = $derived(suggestedSync(repo));
  const nextPreview = $derived(next ? preview({ type: next }, repo) : null);
  const fetch = $derived(preview({ type: "fetch" }, repo));
  const update = $derived(preview({ type: "updateFromBase" }, repo));
  const checking = $derived(fetching || busy === "Fetch");

  const NEXT_LABEL = { push: "Push", pull: "Pull", sync: "Sync" };
  const NEXT_ICON = { push: "cloud-upload", pull: "cloud-download", sync: "sync" };
  const CI_ICON: Record<string, string> = {
    success: "pass-filled",
    failure: "error",
    pending: "loading",
    none: "circle-slash",
    signin: "github",
    error: "warning",
  };

  const run = (request: ActionRequest) => send({ type: "action", request });
</script>

{#if repo.remotes.length > 0}
  <div class="remote-strip" role="region" aria-label="Remote status">
    <span class="strip-item" title={status.upstream ?? "This branch isn't on the remote yet"}>
      <span class="codicon codicon-cloud" aria-hidden="true"></span>
      <b>{status.upstream ?? "not published"}</b>
      {#if !status.branch}
        <span class="muted">detached</span>
      {:else if !status.upstream}
        <span class="muted">only on your machine</span>
      {:else if !status.ahead && !status.behind}
        <span class="ok"><span class="codicon codicon-check"></span>in sync</span>
      {:else}
        {#if status.ahead}<span class="pill out">↑{status.ahead} to push</span>{/if}
        {#if status.behind}<span class="pill in">↓{status.behind} to pull</span>{/if}
      {/if}
      {#if next && nextPreview}
        <button
          class="primary small-button"
          disabled={!nextPreview.ok || !!busy}
          title={nextPreview.text}
          onclick={() => run({ type: next })}
        >
          <span class="codicon codicon-{NEXT_ICON[next]}" class:spin={busy === NEXT_LABEL[next]}
          ></span>{nextPreview.label || NEXT_LABEL[next]}
        </button>
      {/if}
    </span>

    {#if base}
      <span class="strip-item">
        <span class="codicon codicon-git-merge" aria-hidden="true"></span>
        <b>{base.name}</b>
        {#if base.behind === 0}
          <span class="ok"><span class="codicon codicon-check"></span>up to date</span>
        {:else}
          <span class="pill in">{base.behind} new since you branched</span>
          {#if base.conflicts && base.conflicts.length}
            <span class="warn" title={base.conflicts.join("\n")}
              ><span class="codicon codicon-warning"></span>would conflict in {base.conflicts.join(", ")}</span
            >
          {:else}
            <span class="ok"><span class="codicon codicon-pass"></span>merges cleanly</span>
          {/if}
          <button
            class="small-button"
            disabled={!update.ok || !!busy}
            title={update.text}
            onclick={() => run({ type: "updateFromBase" })}>{update.label || `Update from ${base.name}`}</button
          >
        {/if}
      </span>
    {/if}

    {#if repo.ci}
      {@const ci = repo.ci}
      <span class="strip-item ci-{ci.state}">
        <span class="codicon codicon-{CI_ICON[ci.state]}" class:spin={ci.state === "pending"} aria-hidden="true"></span>
        <span title={ci.failed.length ? `Failed: ${ci.failed.join(", ")}` : ci.summary}>CI: {ci.summary}</span>
        {#if ci.state === "signin"}
          <button class="small-button" onclick={() => send({ type: "signInGitHub" })}>Sign in</button>
        {:else}
          <button class="icon-button" title="Open on GitHub" onclick={() => send({ type: "openUrl", url: ci.url })}
            ><span class="codicon codicon-link-external"></span></button
          >
        {/if}
      </span>
    {/if}

    <span class="spacer"></span>
    <span class="strip-item fetched" class:warn={!!repo.fetchError} title={repo.fetchError ?? ""}>
      {#if checking}
        checking…
      {:else if repo.fetchError}
        <span class="codicon codicon-warning"></span>couldn't reach the remote
      {:else}
        {repo.lastFetch ? `checked ${ago(repo.lastFetch)}` : "never checked"}
      {/if}
      <button
        class="icon-button"
        aria-label="Check the remote for new commits"
        title={fetch.ok ? `Check the remote for new commits\n${fetch.text}` : fetch.text}
        disabled={!fetch.ok || !!busy || fetching}
        onclick={() => run({ type: "fetch" })}
      >
        <span class="codicon codicon-repo-fetch" class:spin={checking}></span>
      </button>
    </span>
  </div>
{/if}
