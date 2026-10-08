<script lang="ts">
  import type { CommitDetails, GraphEdge, RepoState } from "../../src/shared/types";
  import CommitPanel from "../shared/CommitPanel.svelte";
  import { laneColor, laneTips, refColor } from "../shared/graph";
  import { relativeTime } from "./util";
  import { send } from "./vscode";

  let { repo, busy, details }: { repo: RepoState; busy: string | null; details: CommitDetails | null } = $props();

  // Vertical branch lanes: each branch keeps its own column and colour; main is always the first.
  const ROW = 26;
  const LANE = 14;
  const PAD = 10;
  const MAX_LANES = 8;

  let selected: number | null = $state(null);

  const graph = $derived(repo.graph);
  const columns = $derived(Math.min(Math.max(graph.rows, 1), MAX_LANES));
  const width = $derived(PAD * 2 + (columns - 1) * LANE);
  const unpushed = $derived(new Set(repo.unpushed));
  const incoming = $derived(new Set(repo.incoming));
  const tips = $derived(laneTips(graph));

  const laneAt = (i: number) => graph.lanes[graph.placement[i].lane];
  const x = (i: number) => PAD + Math.min(laneAt(i).row, MAX_LANES - 1) * LANE;
  const y = (i: number) => i * ROW + ROW / 2;

  function edgePath(edge: GraphEdge): string {
    const [x1, y1, x2, y2] = [x(edge.child), y(edge.child), x(edge.parent), y(edge.parent)];
    if (edge.kind === "line" || x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
    if (edge.kind === "fork") {
      // Run down the branch's own lane, then bend into the commit it forked from.
      const bend = Math.max(y1, y2 - ROW);
      const mid = (bend + y2) / 2;
      return `M${x1} ${y1}V${bend}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
    }
    // A merge leaves the merge commit straight away, then runs down the merged lane.
    const bend = Math.min(y2, y1 + ROW);
    const mid = (y1 + bend) / 2;
    return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${bend}V${y2}`;
  }

  // Forks take the colour of the new branch, merges the colour of the branch merged in.
  const edgeColor = (edge: GraphEdge) => laneColor(laneAt(edge.kind === "merge" ? edge.parent : edge.child).color);

  function select(i: number) {
    selected = selected === i ? null : i;
    if (selected !== null) send({ type: "commitDetails", hash: graph.commits[selected].hash });
  }

  function onKey(event: KeyboardEvent, i: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(i);
    }
  }
</script>

<section class="section graph">
  <div class="group-header">
    <span>Graph</span><span class="count">{graph.commits.length}</span>
    <span class="legend">
      {#if repo.unpushed.length}<span title="Not pushed yet"><i class="dot hollow"></i>local</span>{/if}
      {#if repo.incoming.length}<span title="On the remote, not pulled yet"><i class="dot faded"></i>incoming</span
        >{/if}
    </span>
    <button class="icon-button" title="Open the Branch Map" onclick={() => send({ type: "openBranchMap" })}>
      <span class="codicon codicon-screen-full"></span>
    </button>
  </div>

  {#if graph.commits.length === 0}
    <p class="muted empty">No commits yet.</p>
  {:else}
    <div class="lanes" style="--graph-width: {width}px">
      <svg class="lane-svg" {width} height={graph.commits.length * ROW} aria-hidden="true">
        {#each graph.edges as edge (edge.child + ":" + edge.parent)}
          <path
            d={edgePath(edge)}
            class="edge"
            class:dashed={incoming.has(graph.commits[edge.child].hash)}
            style="stroke: {edgeColor(edge)}"
          />
        {/each}
        {#each graph.commits as commit, i (commit.hash)}
          {@const color = laneColor(laneAt(i).color)}
          {@const isHead = commit.hash === repo.status.oid}
          {#if isHead}<circle cx={x(i)} cy={y(i)} r="7.5" class="halo" style="stroke: {color}" />{/if}
          <circle
            cx={x(i)}
            cy={y(i)}
            r={isHead ? 4.5 : 3.6}
            class="node"
            class:hollow={unpushed.has(commit.hash) || commit.parents.length > 1}
            class:faded={incoming.has(commit.hash)}
            style="stroke: {color}; fill: {color}"
          />
        {/each}
      </svg>

      <ol class="commits">
        {#each graph.commits as commit, i (commit.hash)}
          {@const lane = laneAt(i)}
          {@const isHead = commit.hash === repo.status.oid}
          {@const isIncoming = incoming.has(commit.hash)}
          <li class="commit-item">
            <div
              class="commit"
              class:head={isHead}
              class:incoming={isIncoming}
              class:selected={selected === i}
              role="button"
              tabindex="0"
              aria-pressed={selected === i}
              title="{commit.subject}\n{commit.hash.slice(0, 7)} · {commit.author} · on {lane.name}"
              onclick={() => select(i)}
              onkeydown={(e) => onKey(e, i)}
            >
              <span class="subject">{commit.subject}</span>
              {#each commit.refs as ref (ref.kind + ref.name)}
                {@const color = refColor(graph, ref)}
                <span class="ref ref-{ref.kind}" class:ref-head={ref.isHead} style={color ? `--chip: ${color}` : ""}>
                  {#if ref.kind === "remote"}<span class="codicon codicon-cloud"></span>{/if}
                  {#if ref.kind === "tag"}<span class="codicon codicon-tag"></span>{/if}
                  {ref.name}
                </span>
              {/each}
              {#if (lane.kind === "merged" || lane.kind === "other") && tips.get(graph.placement[i].lane) === i}
                <span
                  class="ref ref-lane"
                  style="--chip: {laneColor(lane.color)}"
                  title={lane.kind === "merged" ? `${lane.name}: merged, branch deleted` : lane.name}
                >
                  {#if lane.kind === "merged"}<span class="codicon codicon-git-merge"></span>{/if}{lane.name}
                </span>
              {/if}
              {#if repo.base && !repo.base.isCurrent && repo.base.behind > 0 && commit.hash === repo.base.forkPoint}
                <span class="ref ref-fork" title="Your branch split off {repo.base.name} here">you branched here</span>
              {/if}
              <span class="time">{relativeTime(commit.time)}</span>
            </div>
          </li>
        {/each}
      </ol>
    </div>

    {#if selected !== null && graph.commits[selected]}
      <CommitPanel {repo} commit={graph.commits[selected]} {details} {busy} {send} onClose={() => (selected = null)} />
    {/if}
  {/if}
</section>
