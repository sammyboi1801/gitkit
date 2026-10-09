<script lang="ts">
  import { onMount } from "svelte";
  import { sideNames, type Resolution } from "../../src/git/conflicts";
  import type { ConflictBlock, RepoState } from "../../src/shared/types";
  import { preview } from "./util";
  import { send } from "./vscode";

  let {
    repo,
    path,
    blocks,
    busy,
  }: { repo: RepoState; path: string; blocks: ConflictBlock[] | undefined; busy: string | null } = $props();

  onMount(() => send({ type: "conflictDetails", path }));

  const names = $derived(sideNames(repo.operation));

  const oursDetail = (b: ConflictBlock) =>
    repo.operation === "rebase" ? (repo.base?.ref ?? b.oursLabel) : (repo.status.branch ?? b.oursLabel);

  const resolve = (block: number | "all", choice: Resolution) => send({ type: "resolveConflict", path, block, choice });
  const markResolved = $derived(preview({ type: "stage", paths: [path] }, repo));
</script>

<div class="conflict-view">
  {#if blocks === undefined}
    <p class="muted">Reading conflicts…</p>
  {:else if blocks.length === 0}
    <div class="conflict-done">
      <span class="ok"><span class="codicon codicon-pass"></span>No conflict markers left in this file.</span>
      <button
        class="primary"
        disabled={!!busy}
        title={markResolved.text}
        onclick={() => send({ type: "action", request: { type: "stage", paths: [path] } })}
      >
        <span class="codicon codicon-check"></span>Mark resolved
      </button>
    </div>
  {:else}
    <!-- When both sides rewrote the same lines, picking one rarely fits: the merge editor shows both side by side. -->
    <button class="wide merge-editor" disabled={!!busy} onclick={() => send({ type: "openMergeEditor", path })}>
      <span class="codicon codicon-git-merge"></span>Open in the merge editor
    </button>
    {#each blocks as block (block.index)}
      <div class="conflict-block">
        <div class="conflict-title">
          Conflict {block.index + 1} of {blocks.length}
          <span class="muted">· line {block.line}</span>
        </div>
        <div class="side side-ours">
          <div class="side-label">{names.ours} <span class="muted">· {oursDetail(block)}</span></div>
          <pre>{block.ours.join("\n") || "(nothing)"}</pre>
        </div>
        <div class="side side-theirs">
          <div class="side-label">{names.theirs} <span class="muted">· {block.theirsLabel}</span></div>
          <pre>{block.theirs.join("\n") || "(nothing)"}</pre>
        </div>
        <div class="conflict-actions">
          <button disabled={!!busy} onclick={() => resolve(block.index, "ours")}>Keep {names.ours.toLowerCase()}</button
          >
          <button disabled={!!busy} onclick={() => resolve(block.index, "theirs")}
            >Keep {names.theirs.toLowerCase()}</button
          >
          <button
            class="link-button keep-both"
            disabled={!!busy}
            title="Keeps both, {names.ours.toLowerCase()} first. Check the result: when both sides rewrote the same code, keeping both usually leaves it twice."
            onclick={() => resolve(block.index, "both")}>Keep both</button
          >
        </div>
      </div>
    {/each}
    {#if blocks.length > 1}
      <div class="conflict-actions all">
        <span class="muted">All {blocks.length}:</span>
        <button disabled={!!busy} onclick={() => resolve("all", "ours")}>Keep {names.ours.toLowerCase()}</button>
        <button disabled={!!busy} onclick={() => resolve("all", "theirs")}>Keep {names.theirs.toLowerCase()}</button>
      </div>
    {/if}
  {/if}
</div>
