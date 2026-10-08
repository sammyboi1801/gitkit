<script lang="ts">
  import type { CommitDetails, GraphLine, RepoState } from "../../src/shared/types";
  import { headAncestors, preview, relativeTime, splitPath } from "./util";
  import { send } from "./vscode";

  let { repo, busy, details }: { repo: RepoState; busy: string | null; details: CommitDetails | null } = $props();

  const LANE = 14;
  const ROW = 26;
  const COLORS = 6;
  const MAX_LANES = 8;

  let expanded: string | null = $state(null);

  const lanes = $derived(Math.min(Math.max(repo.lanes, 1), MAX_LANES));
  const width = $derived(lanes * LANE + 4);
  const unpushed = $derived(new Set(repo.unpushed));
  const incoming = $derived(new Set(repo.incoming));
  const onHead = $derived(headAncestors(repo));

  const x = (lane: number) => LANE / 2 + 2 + Math.min(lane, MAX_LANES - 1) * LANE;
  const y = (level: 0 | 1 | 2) => (level * ROW) / 2;

  function path(line: GraphLine): string {
    const [x1, y1, x2, y2] = [x(line.x1), y(line.y1), x(line.x2), y(line.y2)];
    if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
    const mid = (y1 + y2) / 2;
    return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
  }

  function toggle(hash: string) {
    expanded = expanded === hash ? null : hash;
    if (expanded) send({ type: "commitDetails", hash });
  }

  function onKey(event: KeyboardEvent, hash: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(hash);
    }
  }
</script>

<section class="section graph">
  <div class="group-header">
    <span>Graph</span><span class="count">{repo.rows.length}</span>
    <span class="legend">
      {#if repo.unpushed.length}<span title="Not pushed yet"><i class="dot hollow"></i>local</span>{/if}
      {#if repo.incoming.length}<span title="On the remote, not pulled yet"><i class="dot faded"></i>incoming</span
        >{/if}
    </span>
  </div>
  {#if repo.rows.length === 0}
    <p class="muted empty">No commits yet.</p>
  {/if}
  <ol class="commits">
    {#each repo.rows as row (row.commit.hash)}
      {@const commit = row.commit}
      {@const isHead = commit.hash === repo.status.oid}
      {@const isLocal = unpushed.has(commit.hash)}
      {@const isIncoming = incoming.has(commit.hash)}
      {@const open = expanded === commit.hash}
      <li class="commit-item" class:open>
        <div
          class="commit"
          class:head={isHead}
          class:incoming={isIncoming}
          role="button"
          tabindex="0"
          aria-expanded={open}
          title="{commit.subject}\n{commit.hash.slice(0, 7)} · {commit.author} · {new Date(
            commit.time * 1000,
          ).toLocaleString()}{isLocal ? '\nNot pushed yet' : ''}{isIncoming ? '\nOn the remote, not pulled yet' : ''}"
          onclick={() => toggle(commit.hash)}
          onkeydown={(e) => onKey(e, commit.hash)}
        >
          <svg {width} height={ROW} viewBox="0 0 {width} {ROW}" aria-hidden="true">
            {#each row.lines as line, i (i)}
              <path d={path(line)} class="edge lane-{line.lane % COLORS}" class:dashed={isIncoming} />
            {/each}
            {#if isHead}
              <circle cx={x(row.lane)} cy={ROW / 2} r="7" class="halo lane-{row.lane % COLORS}" />
            {/if}
            <circle
              cx={x(row.lane)}
              cy={ROW / 2}
              r={isHead ? 4.5 : 3.5}
              class="node lane-{row.lane % COLORS}"
              class:hollow={isLocal || commit.parents.length > 1}
              class:faded={isIncoming}
            />
          </svg>
          <span class="subject">{commit.subject}</span>
          {#each commit.refs as ref (ref.kind + ref.name)}
            <span class="ref ref-{ref.kind}" class:ref-head={ref.isHead}>
              {#if ref.kind === "remote"}<span class="codicon codicon-cloud"></span>{/if}
              {#if ref.kind === "tag"}<span class="codicon codicon-tag"></span>{/if}
              {ref.name}
            </span>
          {/each}
          <span class="time">{relativeTime(commit.time)}</span>
        </div>

        {#if open}
          <div class="details" style="--indent: {width + 12}px">
            {#if details?.hash === commit.hash}
              <div class="meta">
                <span>{details.author}</span>
                <span class="muted">{new Date(details.time * 1000).toLocaleString()}</span>
              </div>
              {#if details.body !== commit.subject}
                <p class="body">{details.body}</p>
              {/if}
              <ul class="detail-files">
                {#each details.files as file (file.path)}
                  {@const { name, dir } = splitPath(file.path)}
                  <li title={file.path}>
                    <span class="name">{name}</span>
                    {#if dir}<span class="dir">{dir}</span>{/if}
                    <span class="stats">
                      {#if file.stats.binary}<span class="muted">bin</span>{:else}
                        {#if file.stats.added}<span class="stat-add">+{file.stats.added}</span>{/if}
                        {#if file.stats.removed}<span class="stat-del">−{file.stats.removed}</span>{/if}
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
              <div class="detail-actions">
                <button title="Copy {commit.hash}" onclick={() => send({ type: "copyHash", hash: commit.hash })}>
                  <span class="codicon codicon-copy"></span>{commit.hash.slice(0, 7)}
                </button>
                <button
                  title="git switch -c <name> {commit.hash.slice(0, 7)}"
                  disabled={!!busy}
                  onclick={() => send({ type: "branchFrom", hash: commit.hash })}
                >
                  <span class="codicon codicon-git-branch-create"></span>Branch
                </button>
                {#if onHead.has(commit.hash)}
                  {@const revert = preview({ type: "revert", hash: commit.hash }, repo)}
                  <button
                    title={revert.text}
                    disabled={!revert.ok || !!busy}
                    onclick={() => send({ type: "action", request: { type: "revert", hash: commit.hash } })}
                  >
                    <span class="codicon codicon-discard"></span>Revert
                  </button>
                {:else}
                  {@const pick = preview({ type: "cherryPick", hash: commit.hash }, repo)}
                  <button
                    title={pick.text}
                    disabled={!pick.ok || !!busy}
                    onclick={() => send({ type: "action", request: { type: "cherryPick", hash: commit.hash } })}
                  >
                    <span class="codicon codicon-git-pull-request-go-to-changes"></span>Cherry-pick
                  </button>
                {/if}
              </div>
            {:else}
              <p class="muted">Loading…</p>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</section>
