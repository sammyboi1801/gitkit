<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ActionError, HostToWebview, PulseState } from "../../src/shared/messages";
  import type { Commit, CommitDetails, GraphEdge } from "../../src/shared/types";
  import CommitPanel from "../shared/CommitPanel.svelte";
  import { applyMainColor, laneColor, laneStarts, refColor } from "../shared/graph";
  import { ago } from "../pulse/util";
  import { send } from "../pulse/vscode";

  // Horizontal branch lanes: time runs left to right, main is the top lane, each branch its own row.
  const ROW_H = 64;
  const TOP = 56;
  const LEFT = 36;
  const R = 9;

  let view = $state<PulseState>({ kind: "loading" });
  let busy: string | null = $state(null);
  let error: ActionError | null = $state(null);
  let details: CommitDetails | null = $state(null);
  let zoom = $state(1);
  let selected: string | null = $state(null);
  let hovered: { commit: Commit; x: number; y: number } | null = $state(null);
  let scroller: HTMLDivElement | undefined = $state();
  let scrolledOnce = false;

  const repo = $derived(view.kind === "repo" ? view.repo : null);
  const graph = $derived(repo?.graph ?? null);
  const col = $derived(46 * zoom);
  const width = $derived(graph ? LEFT * 2 + Math.max(graph.commits.length - 1, 0) * col + 120 : 0);
  const height = $derived(graph ? TOP + Math.max(graph.rows - 1, 0) * ROW_H + 70 : 0);
  const unpushed = $derived(new Set(repo?.unpushed ?? []));
  const incoming = $derived(new Set(repo?.incoming ?? []));
  const starts = $derived(graph ? laneStarts(graph) : new Map<number, number>());
  const selectedCommit = $derived(graph?.commits.find((c) => c.hash === selected) ?? null);

  const lane = (i: number) => graph!.lanes[graph!.placement[i].lane];
  const x = (i: number) => LEFT + graph!.placement[i].column * col;
  const y = (i: number) => TOP + lane(i).row * ROW_H;

  /** Fork and merge connectors bend once, with rounded elbows, like a hand-drawn branch diagram. */
  function edgePath(edge: GraphEdge): string {
    const [xp, yp, xc, yc] = [x(edge.parent), y(edge.parent), x(edge.child), y(edge.child)];
    if (yp === yc) return `M${xp} ${yp}H${xc}`;
    // Forks bend right after the parent; merges bend right before the merge commit.
    const xm = edge.kind === "merge" ? xc - col / 2 : xp + col / 2;
    const r = Math.min(12, Math.abs(yc - yp) / 2, col / 2 - 1);
    const s = Math.sign(yc - yp);
    return `M${xp} ${yp}H${xm - r}Q${xm} ${yp} ${xm} ${yp + s * r}V${yc - s * r}Q${xm} ${yc} ${xm + r} ${yc}H${xc}`;
  }

  const edgeColor = (edge: GraphEdge) => laneColor(lane(edge.kind === "merge" ? edge.parent : edge.child).color);

  async function scrollToNewest() {
    await tick();
    scroller?.scrollTo({ left: scroller.scrollWidth, behavior: scrolledOnce ? "smooth" : "auto" });
    scrolledOnce = true;
  }

  function setZoom(next: number) {
    // Keep the view centred on the same moment in time while zooming.
    const ratio = scroller ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 1;
    zoom = Math.min(2, Math.max(0.5, next));
    void tick().then(() => {
      if (scroller) scroller.scrollLeft = ratio * scroller.scrollWidth - scroller.clientWidth / 2;
    });
  }

  function select(commit: Commit) {
    selected = selected === commit.hash ? null : commit.hash;
    if (selected) send({ type: "commitDetails", hash: commit.hash });
  }

  onMount(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      if (message.type === "state") {
        const firstGraph = !graph;
        view = message.state;
        if (firstGraph) void scrollToNewest();
      } else if (message.type === "busy") {
        busy = message.label;
        if (busy) error = null;
      } else if (message.type === "error") error = message.error;
      else if (message.type === "commitDetails") details = message.details;
      else if (message.type === "config") applyMainColor(message.mainBranchColor);
    };
    window.addEventListener("message", onMessage);
    send({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  });
</script>

<main class="map">
  {#if !repo || !graph}
    <p class="muted pad">
      {view.kind === "loading" ? "Reading repository…" : "Open a git repository to see its branches."}
    </p>
  {:else}
    <header class="toolbar">
      <span class="codicon codicon-repo"></span>
      <b>{repo.root.split(/[\\/]/).pop()}</b>
      <span class="muted">on</span>
      <span class="codicon codicon-git-branch accent"></span>
      <span>{repo.status.branch ?? "detached"}</span>
      <span class="spacer"></span>
      <span class="legend">
        {#each graph.lanes.filter((l) => l.kind !== "other") as l (l.name)}
          <span class="legend-lane"><i style="background: {laneColor(l.color)}"></i>{l.name}</span>
        {/each}
      </span>
      <span class="spacer"></span>
      <button class="icon-button" title="Zoom out" onclick={() => setZoom(zoom - 0.25)}
        ><span class="codicon codicon-zoom-out"></span></button
      >
      <button class="icon-button" title="Zoom in" onclick={() => setZoom(zoom + 0.25)}
        ><span class="codicon codicon-zoom-in"></span></button
      >
      <button class="icon-button" title="Jump to the newest commits" onclick={scrollToNewest}
        ><span class="codicon codicon-arrow-right"></span></button
      >
    </header>

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

    <div class="canvas" bind:this={scroller} onscroll={() => (hovered = null)}>
      <svg {width} {height} role="img" aria-label="Branch map of {repo.root}">
        <!-- Faint guide line per row, like lanes on a road. -->
        {#each { length: graph.rows } as _, row (row)}
          <line x1="0" x2={width} y1={TOP + row * ROW_H} y2={TOP + row * ROW_H} class="guide" />
        {/each}

        {#each graph.edges as edge (edge.child + ":" + edge.parent)}
          <path
            d={edgePath(edge)}
            class="map-edge"
            class:dashed={incoming.has(graph.commits[edge.child].hash)}
            style="stroke: {edgeColor(edge)}"
          />
        {/each}

        <!-- Lane names, under each lane's first commit. -->
        {#each [...starts] as [laneIndex, i] (laneIndex)}
          {@const l = graph.lanes[laneIndex]}
          <g class="lane-label" transform="translate({x(i)}, {y(i) + R + 16})">
            <text text-anchor="middle" style="fill: {laneColor(l.color)}">
              {l.name}{l.kind === "merged" ? " (merged)" : ""}
            </text>
          </g>
        {/each}

        {#each graph.commits as commit, i (commit.hash)}
          {@const color = laneColor(lane(i).color)}
          {@const isHead = commit.hash === repo.status.oid}
          <g
            class="map-node"
            class:selected={selected === commit.hash}
            class:faded={incoming.has(commit.hash)}
            role="button"
            tabindex="0"
            aria-label="{commit.subject}, {commit.hash.slice(0, 7)}"
            onclick={() => select(commit)}
            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && select(commit)}
            onmouseenter={() => (hovered = { commit, x: x(i), y: y(i) })}
            onmouseleave={() => (hovered = null)}
          >
            {#if isHead}<circle cx={x(i)} cy={y(i)} r={R + 6} class="map-halo" style="stroke: {color}" />{/if}
            <circle cx={x(i)} cy={y(i)} r={R + 3.5} class="map-ring" />
            <circle
              cx={x(i)}
              cy={y(i)}
              r={R}
              class="map-dot"
              class:hollow={unpushed.has(commit.hash)}
              style="fill: {color}; stroke: {color}"
            />
            <!-- Branch and tag flags above the commit they point at, stacked if several. -->
            {#each commit.refs as ref, k (ref.kind + ref.name)}
              {@const chip = refColor(graph, ref) ?? "var(--vscode-charts-yellow)"}
              {@const label = ref.kind === "tag" ? `🏷 ${ref.name}` : ref.name}
              {@const w = label.length * 6.4 + 12}
              <g class="flag flag-{ref.kind}" transform="translate({x(i) - w / 2}, {y(i) - R - 26 - k * 20})">
                <rect width={w} height="16" rx="3" style="--chip: {chip}" />
                <text x={w / 2} y="11.5" text-anchor="middle">{label}</text>
              </g>
            {/each}
          </g>
        {/each}
      </svg>

      {#if hovered}
        {@const scrollLeft = scroller?.scrollLeft ?? 0}
        <div class="tooltip" style="left: {hovered.x - scrollLeft}px; top: {hovered.y + R + 30}px">
          <b>{hovered.commit.subject}</b>
          <span class="muted"
            >{hovered.commit.hash.slice(0, 7)} · {hovered.commit.author} · {ago(hovered.commit.time)}</span
          >
          {#if unpushed.has(hovered.commit.hash)}<span class="muted">Not pushed yet</span>{/if}
          {#if incoming.has(hovered.commit.hash)}<span class="muted">On the remote, not pulled yet</span>{/if}
        </div>
      {/if}
    </div>

    {#if selectedCommit}
      <div class="map-panel">
        <CommitPanel {repo} commit={selectedCommit} {details} {busy} {send} onClose={() => (selected = null)} />
      </div>
    {/if}
  {/if}
</main>
