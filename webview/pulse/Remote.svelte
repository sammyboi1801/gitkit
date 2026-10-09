<script lang="ts">
  import type { ActivityItem, RepoState } from "../../src/shared/types";
  import PrStatus from "../shared/PrStatus.svelte";
  import { ago, preview } from "./util";
  import { send } from "./vscode";

  let { repo, busy, fetching }: { repo: RepoState; busy: string | null; fetching: boolean } = $props();

  const status = $derived(repo.status);
  const base = $derived(repo.base && !repo.base.isCurrent ? repo.base : null);
  const fetch = $derived(preview({ type: "fetch" }, repo));
  const update = $derived(preview({ type: "updateFromBase" }, repo));

  const ciIcon: Record<string, string> = {
    success: "pass-filled",
    failure: "error",
    pending: "loading",
    none: "circle-slash",
    signin: "github",
    error: "warning",
  };

  const MAX_DOTS = 5;
  const dots = (n: number) => Math.min(n, MAX_DOTS);

  function who(item: ActivityItem): string {
    if (item.byYou) return "You";
    const [first, second, ...rest] = item.authors;
    if (!first) return "Someone";
    if (!second) return first;
    return rest.length ? `${first}, ${second} +${rest.length}` : `${first} & ${second}`;
  }

  function what(item: ActivityItem): string {
    const n = `${item.commits} commit${item.commits === 1 ? "" : "s"}`;
    switch (item.kind) {
      case "push":
        return `pushed ${n} to`;
      case "forced":
        return `rewrote history (${n}) on`;
      case "created":
        return "published";
      default:
        return `added ${n} to`;
    }
  }

  const icon = (item: ActivityItem) =>
    ({ push: "arrow-up", fetch: "arrow-down", forced: "warning", created: "add" })[item.kind];
</script>

{#if repo.remotes.length > 0}
  <section class="section remote">
    <div class="group-header">
      <span>Remote</span>
      <span class="fetched" class:warn={!!repo.fetchError} title={repo.fetchError ?? ""}>
        {#if fetching || busy === "Fetch"}
          checking…
        {:else if repo.fetchError}
          <span class="codicon codicon-warning"></span>couldn't reach remote
        {:else}
          {repo.lastFetch ? `fetched ${ago(repo.lastFetch)}` : "never fetched"}
        {/if}
      </span>
      <button
        class="icon-button"
        title={fetch.ok ? `Check for new commits now\n${fetch.text}` : fetch.text}
        disabled={!fetch.ok || !!busy || fetching}
        onclick={() => send({ type: "action", request: { type: "fetch" } })}
      >
        <span class="codicon codicon-repo-fetch" class:spin={fetching || busy === "Fetch"}></span>
      </button>
    </div>

    <!-- This branch vs its copy on the remote -->
    <div class="remote-row">
      <span class="codicon codicon-cloud row-icon"></span>
      <span class="row-label" title={status.upstream ?? "No remote branch yet"}
        >{status.upstream ?? "not published"}</span
      >
      <span class="row-status">
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
      </span>
    </div>

    <!-- This branch vs main: the picture of who moved since you branched -->
    {#if base}
      <div class="remote-row base-row">
        <span class="codicon codicon-git-merge row-icon"></span>
        <span class="row-label">{base.ref}</span>
        <span class="row-status">
          {#if base.behind === 0}
            <span class="ok"><span class="codicon codicon-check"></span>up to date</span>
          {:else}
            <span class="pill in">{base.behind} new since you branched</span>
          {/if}
        </span>
      </div>

      <div class="divergence" title="Your branch and {base.name}, from where you branched off">
        <svg width="86" height="30" viewBox="0 0 86 30" aria-hidden="true">
          <path d="M4 15 C 14 15, 14 6, 24 6 L 82 6" class="track mine" />
          <path d="M4 15 C 14 15, 14 24, 24 24 L 82 24" class="track theirs" />
          <circle cx="4" cy="15" r="2.6" class="fork" />
          {#each { length: dots(base.ahead) } as _, i (i)}
            <circle cx={30 + i * 11} cy="6" r="3" class="dot-mine" />
          {/each}
          {#each { length: dots(base.behind) } as _, i (i)}
            <circle cx={30 + i * 11} cy="24" r="3" class="dot-theirs" />
          {/each}
        </svg>
        <div class="divergence-labels">
          <span><b>you</b> {base.ahead} commit{base.ahead === 1 ? "" : "s"}</span>
          <span><b>{base.name}</b> {base.behind} commit{base.behind === 1 ? "" : "s"}</span>
        </div>
      </div>

      {#if base.behind > 0}
        <div class="merge-forecast">
          {#if base.conflicts === null}
            <span class="ok"><span class="codicon codicon-pass"></span>no overlap: updates cleanly</span>
          {:else if base.conflicts.length === 0}
            <span class="ok"><span class="codicon codicon-pass"></span>merges cleanly, no conflicts</span>
          {:else}
            <span class="warn" title={base.conflicts.join("\n")}
              ><span class="codicon codicon-warning"></span>would conflict in {base.conflicts.join(", ")}</span
            >
          {/if}
        </div>
        <button
          class="wide"
          class:primary={!!base.conflicts && base.conflicts.length === 0}
          disabled={!update.ok || !!busy}
          title={update.text}
          onclick={() => send({ type: "action", request: { type: "updateFromBase" } })}
        >
          <span class="codicon codicon-git-pull-request"></span>{update.label || `Update from ${base.name}`}
        </button>
      {/if}
    {/if}

    <!-- GitHub checks for the latest pushed commit. -->
    {#if repo.ci}
      {@const ci = repo.ci}
      <div class="remote-row ci-row ci-{ci.state}">
        <span class="codicon codicon-{ciIcon[ci.state]} row-icon" class:spin={ci.state === "pending"}></span>
        <span class="row-label">CI</span>
        <span class="ci-summary" title={ci.failed.length ? `Failed: ${ci.failed.join(", ")}` : ci.summary}>
          {ci.summary}{ci.failed.length ? `: ${ci.failed.join(", ")}` : ""}
        </span>
        <span class="row-status">
          {#if ci.state === "signin"}
            <button class="small-button" onclick={() => send({ type: "signInGitHub" })}>Sign in</button>
          {:else}
            {#if ci.state === "failure" && ci.runId}
              <button
                class="small-button"
                title="Re-run only the failed jobs"
                onclick={() => send({ type: "rerunFailed" })}>Re-run</button
              >
            {/if}
            <button class="icon-button" title="Open on GitHub" onclick={() => send({ type: "openUrl", url: ci.url })}
              ><span class="codicon codicon-link-external"></span></button
            >
          {/if}
        </span>
      </div>
    {/if}

    {#if repo.pr}
      <div class="remote-row pr-row"><PrStatus {repo} {busy} {send} /></div>
    {/if}

    {#if repo.activity.length}
      <ul class="activity">
        {#each repo.activity.slice(0, 4) as item (item.ref + item.time)}
          <li title="{item.ref} · {new Date(item.time * 1000).toLocaleString()}">
            <span class="codicon codicon-{icon(item)} kind-{item.kind}"></span>
            <span class="who">{who(item)}</span>
            <span class="what">{what(item)} <b>{item.ref}</b></span>
            <span class="time">{ago(item.time)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
