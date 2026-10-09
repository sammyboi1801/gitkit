<script lang="ts">
  import { readiness } from "../../src/github/pr";
  import type { WebviewToHost } from "../../src/shared/messages";
  import type { RepoState } from "../../src/shared/types";

  // The branch's pull request in one line: "PR #42 · CI passing · approved · merges cleanly",
  // or a way to open one. Shared by the Pulse sidebar and the Branch Map.

  let { repo, busy, send }: { repo: RepoState; busy: string | null; send: (message: WebviewToHost) => void } = $props();

  const info = $derived(repo.pr ?? null);
  const summary = $derived(info?.kind === "open" ? readiness(info.pr, repo.ci, repo.base?.conflicts) : null);
</script>

{#if info?.kind === "open" && summary}
  {@const pr = info.pr}
  <span class="pr-status" class:ready={summary.ready} role="group" aria-label="Pull request #{pr.number}">
    <span class="codicon codicon-{pr.draft ? 'git-pull-request-draft' : 'git-pull-request'} pr-icon" aria-hidden="true"
    ></span>
    <button class="pr-link" title="{pr.title}: open on GitHub" onclick={() => send({ type: "openUrl", url: pr.url })}
      >PR #{pr.number}</button
    >
    {#if summary.ready}<span class="pr-part tone-ok"
        ><span class="codicon codicon-check"></span>ready to merge{summary.parts.length ? "," : ""}</span
      >{/if}
    <!-- Commas as real text, so it reads as a sentence on screen and to screen readers. -->
    {#each summary.parts as part, i (part.text)}
      <span class="pr-part tone-{part.tone}">{part.text}{i < summary.parts.length - 1 ? "," : ""}</span>
    {/each}
    {#if !info.signedIn}
      <button
        class="pr-link muted"
        title="GitHub only shows review comments to signed-in users"
        onclick={() => send({ type: "signInGitHub" })}>sign in for comments</button
      >
    {/if}
  </span>
{:else if info?.kind === "none"}
  <span class="pr-status" role="group" aria-label="Pull request">
    <span class="codicon codicon-git-pull-request pr-icon" aria-hidden="true"></span>
    <span class="muted">No pull request into {info.base} yet</span>
    <button
      class="small-button"
      disabled={!!busy}
      title="Choose a title, then create it, create it as a draft, or finish it on GitHub"
      onclick={() => send({ type: "createPr" })}>Open a PR</button
    >
  </span>
{/if}
