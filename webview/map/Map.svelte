<script lang="ts">
  import { onMount, tick } from "svelte";
  import { compactGraph, type DisplayEdge, type DisplayNode } from "../../src/git/compact";
  import type { ActionRequest } from "../../src/git/actions";
  import type { ActionError, HostToWebview, PulseState } from "../../src/shared/messages";
  import type { Commit, CommitDetails } from "../../src/shared/types";
  import CommitPanel from "../shared/CommitPanel.svelte";
  import { applyMainColor, laneColor, laneStarts, refColor } from "../shared/graph";
  import { ago, headAncestors, preview } from "../pulse/util";
  import { send } from "../pulse/vscode";
  import Menu from "./Menu.svelte";
  import type { MenuItem } from "./menu";
  import { initials, matches, people } from "./people";

  // Horizontal branch lanes: time runs left to right, main is the top lane, each branch its own row.
  const ROW_H = 64;
  const TOP = 60;
  const LEFT = 40;
  const BASE_COL = 46;
  const AUTO_COMPACT = 30;

  type CommitNode = Extract<DisplayNode, { kind: "commit" }>;
  type GroupNode = Extract<DisplayNode, { kind: "group" }>;
  interface Drag {
    branch: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    over: string | null;
  }

  let view = $state<PulseState>({ kind: "loading" });
  let busy: string | null = $state(null);
  let error: ActionError | null = $state(null);
  let details: CommitDetails | null = $state(null);
  let zoom = $state(1);
  let selected: string | null = $state(null);
  let hovered: { commit: Commit; x: number; y: number } | null = $state(null);
  let hoveredLane: number | null = $state(null);
  let search = $state("");
  let person: string | null = $state(null);
  let compactChoice: boolean | null = $state(null);
  let expanded: Set<string> = $state(new Set());
  let menu: { x: number; y: number; heading: string; items: MenuItem[] } | null = $state(null);
  let drag: Drag | null = $state(null);
  let scroller: HTMLDivElement | undefined = $state();
  let scrolledOnce = false;

  const repo = $derived(view.kind === "repo" ? view.repo : null);
  const graph = $derived(repo?.graph ?? null);
  const current = $derived(repo?.status.branch ?? null);
  const compact = $derived(compactChoice ?? (graph?.commits.length ?? 0) > AUTO_COMPACT);
  const hits = $derived(new Set(graph?.commits.filter((c) => matches(c, search)).map((c) => c.hash) ?? []));
  const display = $derived.by(() => {
    if (!graph) return null;
    const keep = new Set([...hits, ...expanded]);
    if (repo?.status.oid) keep.add(repo.status.oid);
    if (selected) keep.add(selected);
    return compactGraph(graph, { compact, keep });
  });
  const nodeById = $derived(new Map(display?.nodes.map((n) => [n.id, n]) ?? []));
  const commitNodes = $derived(display?.nodes.filter((n): n is CommitNode => n.kind === "commit") ?? []);
  const team = $derived(graph ? people(graph.commits) : []);
  const unpushed = $derived(new Set(repo?.unpushed ?? []));
  const incoming = $derived(new Set(repo?.incoming ?? []));
  const onHead = $derived(repo ? headAncestors(repo) : new Set<string>());
  const col = $derived(BASE_COL * zoom);
  const R = $derived(zoom >= 0.75 ? 11 : 7);
  const width = $derived(display ? LEFT * 2 + Math.max(display.columns - 1, 0) * col + 140 : 0);
  const height = $derived(graph ? TOP + Math.max(graph.rows - 1, 0) * ROW_H + 72 : 0);
  const selectedCommit = $derived(graph?.commits.find((c) => c.hash === selected) ?? null);
  const localBranches = $derived(
    new Set(graph?.commits.flatMap((c) => c.refs.filter((r) => r.kind === "local").map((r) => r.name)) ?? []),
  );

  // Lane names go under each lane's first commit, unless a branch flag there already says it.
  const laneLabels = $derived.by(() => {
    if (!graph) return [];
    return [...laneStarts(graph)].flatMap(([laneIndex, i]) => {
      const lane = graph.lanes[laneIndex];
      const commit = graph.commits[i];
      if (commit.refs.some((r) => r.kind === "local" && r.name === lane.name)) return [];
      const node = nodeById.get(commit.hash);
      return node ? [{ lane, node, laneIndex }] : [];
    });
  });

  const laneOf = (node: DisplayNode) => graph!.lanes[node.lane];
  const x = (node: DisplayNode) => LEFT + node.column * col;
  const y = (node: DisplayNode) => TOP + laneOf(node).row * ROW_H;
  const commitOf = (node: CommitNode) => graph!.commits[node.index];

  /** Dimmed when a person or search filter is on and this doesn't match, or another lane is hovered. */
  function dimmed(node: DisplayNode): boolean {
    const commits = node.kind === "commit" ? [graph!.commits[node.index]] : node.indices.map((i) => graph!.commits[i]);
    if (person && !commits.some((c) => c.author === person)) return true;
    if (search.trim() && !commits.some((c) => hits.has(c.hash))) return true;
    return hoveredLane !== null && node.lane !== hoveredLane;
  }

  /** Fork and merge connectors bend once, with rounded elbows, like a hand-drawn branch diagram. */
  function edgePath(edge: DisplayEdge): string {
    const child = nodeById.get(edge.from)!;
    const parent = nodeById.get(edge.to)!;
    const [xp, yp, xc, yc] = [x(parent), y(parent), x(child), y(child)];
    if (yp === yc) return `M${xp} ${yp}H${xc}`;
    // Forks bend right after the parent; merges bend right before the merge commit.
    const xm = edge.kind === "merge" ? xc - col / 2 : xp + col / 2;
    const r = Math.min(12, Math.abs(yc - yp) / 2, col / 2 - 1);
    const s = Math.sign(yc - yp);
    return `M${xp} ${yp}H${xm - r}Q${xm} ${yp} ${xm} ${yp + s * r}V${yc - s * r}Q${xm} ${yc} ${xm + r} ${yc}H${xc}`;
  }

  const edgeLane = (edge: DisplayEdge) => nodeById.get(edge.kind === "merge" ? edge.to : edge.from)!.lane;

  function item(label: string, icon: string, request: ActionRequest): MenuItem {
    const p = preview(request, repo!);
    return { label, icon, title: p.text, disabled: !p.ok || !!busy, run: () => send({ type: "action", request }) };
  }

  function tipOf(branch: string): string | undefined {
    return graph?.commits.find((c) => c.refs.some((r) => r.kind === "local" && r.name === branch))?.hash;
  }

  function openBranchMenu(branch: string, at: { x: number; y: number }) {
    const tip = tipOf(branch);
    const items: MenuItem[] = [];
    if (branch !== current) {
      items.push(item(`Switch to ${branch}`, "arrow-swap", { type: "switch", branch }));
      if (current) {
        items.push(item(`Merge ${branch} into ${current}`, "git-merge", { type: "mergeBranch", branch }));
        items.push(item(`Rebase ${current} onto ${branch}`, "git-pull-request", { type: "rebaseOnto", branch }));
      }
    }
    if (tip) {
      items.push({
        label: "New branch from here",
        icon: "git-branch-create",
        run: () => send({ type: "branchFrom", hash: tip }),
      });
    }
    if (branch !== current) items.push(item(`Delete ${branch}`, "trash", { type: "deleteBranches", names: [branch] }));
    menu = { ...at, heading: branch === current ? `${branch} (current)` : branch, items };
  }

  /** Dragging one branch onto another: what that can sensibly mean depends on which is checked out. */
  function openDropMenu(source: string, target: string, at: { x: number; y: number }) {
    const items: MenuItem[] = [];
    if (target === current) {
      items.push(item(`Merge ${source} into ${target}`, "git-merge", { type: "mergeBranch", branch: source }));
    } else if (source === current) {
      items.push(item(`Rebase ${source} onto ${target}`, "git-pull-request", { type: "rebaseOnto", branch: target }));
      items.push(item(`Merge ${target} into ${source}`, "git-merge", { type: "mergeBranch", branch: target }));
    } else {
      items.push(
        item(`Switch to ${target} and merge ${source} into it`, "git-merge", {
          type: "switchAndMerge",
          target,
          source,
        }),
      );
    }
    menu = { ...at, heading: `${source} → ${target}`, items };
  }

  function openCommitMenu(commit: Commit, at: { x: number; y: number }) {
    menu = {
      ...at,
      heading: commit.subject,
      items: [
        { label: "Show details", icon: "info", run: () => select(commit.hash, true) },
        {
          label: "New branch from here",
          icon: "git-branch-create",
          run: () => send({ type: "branchFrom", hash: commit.hash }),
        },
        {
          label: `Copy ${commit.hash.slice(0, 7)}`,
          icon: "copy",
          run: () => send({ type: "copyHash", hash: commit.hash }),
        },
        onHead.has(commit.hash)
          ? item("Revert this commit", "discard", { type: "revert", hash: commit.hash })
          : item("Cherry-pick onto the current branch", "git-pull-request-go-to-changes", {
              type: "cherryPick",
              hash: commit.hash,
            }),
      ],
    };
  }

  /** Menu position inside the canvas, from a pointer event. */
  function at(event: MouseEvent): { x: number; y: number } {
    const box = scroller?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }

  function select(hash: string, force = false) {
    selected = selected === hash && !force ? null : hash;
    if (selected) send({ type: "commitDetails", hash: selected });
  }

  function expand(node: GroupNode) {
    expanded = new Set([...expanded, ...node.indices.map((i) => graph!.commits[i].hash)]);
  }

  /** Arrow keys step through commits in time order; Escape closes menus and details. */
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      menu = null;
      selected = null;
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (!commitNodes.length) return;
    const now = commitNodes.findIndex((n) => n.id === selected);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = now === -1 ? commitNodes.length - 1 : Math.min(commitNodes.length - 1, Math.max(0, now + step));
    const node = commitNodes[next];
    select(node.id, true);
    scroller?.scrollTo({ left: x(node) - scroller.clientWidth / 2, behavior: "smooth" });
  }

  async function scrollToNewest() {
    await tick();
    scroller?.scrollTo({ left: scroller.scrollWidth, behavior: scrolledOnce ? "smooth" : "auto" });
    scrolledOnce = true;
  }

  function setZoom(next: number) {
    // Keep the view centred on the same moment in time while zooming.
    const ratio = scroller ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 1;
    zoom = Math.min(2, Math.max(0.3, next));
    void tick().then(() => {
      if (scroller) scroller.scrollLeft = ratio * scroller.scrollWidth - scroller.clientWidth / 2;
    });
  }

  /** Zoom so the whole (compacted) history fits the window width. */
  function fit() {
    if (!display || !scroller) return;
    const available = scroller.clientWidth - LEFT * 2 - 140;
    setZoom(display.columns > 1 ? available / ((display.columns - 1) * BASE_COL) : 1);
  }

  function startDrag(event: PointerEvent, branch: string) {
    event.stopPropagation();
    const { clientX, clientY } = event;
    drag = { branch, startX: clientX, startY: clientY, x: clientX, y: clientY, active: false, over: null };
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
    // Branch drag-and-drop: a press on a flag becomes a drag once the pointer moves a little;
    // a press without movement is a click and opens that branch's menu.
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5;
      drag = { ...drag, x: e.clientX, y: e.clientY, active: drag.active || moved };
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const { branch, active, over } = drag;
      drag = null;
      if (!active) openBranchMenu(branch, at(e));
      else if (over && over !== branch) openDropMenu(branch, over, at(e));
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    send({ type: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });
</script>

<main class="map" class:dragging={drag?.active}>
  {#if !repo || !graph || !display}
    <p class="muted pad">
      {view.kind === "loading" ? "Reading repository…" : "Open a git repository to see its branches."}
    </p>
  {:else}
    <header class="toolbar">
      <span class="codicon codicon-repo"></span>
      <b>{repo.root.split(/[\\/]/).pop()}</b>
      <span class="muted">on</span>
      <span class="codicon codicon-git-branch accent"></span>
      <span>{current ?? "detached"}</span>

      <label class="search">
        <span class="codicon codicon-search"></span>
        <input
          type="search"
          placeholder="Find commits by message, author or hash"
          bind:value={search}
          aria-label="Find commits"
        />
        {#if search.trim()}<span class="muted">{hits.size}</span>{/if}
      </label>

      <span class="spacer"></span>
      <button
        class="icon-button"
        class:on={compact}
        aria-pressed={compact}
        title={compact ? "Show every commit" : "Fold quiet stretches into +N"}
        onclick={() => (compactChoice = !compact)}
      >
        <span class="codicon codicon-{compact ? 'unfold' : 'fold'}"></span>
      </button>
      <button class="icon-button" title="Zoom out" onclick={() => setZoom(zoom - 0.25)}>
        <span class="codicon codicon-zoom-out"></span>
      </button>
      <button class="icon-button" title="Zoom in" onclick={() => setZoom(zoom + 0.25)}>
        <span class="codicon codicon-zoom-in"></span>
      </button>
      <button class="icon-button" title="Fit to window" onclick={fit}>
        <span class="codicon codicon-screen-normal"></span>
      </button>
      <button class="icon-button" title="Jump to the newest commits" onclick={scrollToNewest}>
        <span class="codicon codicon-arrow-right"></span>
      </button>
    </header>

    {#if team.length > 1}
      <div class="people" role="group" aria-label="Filter by author">
        <span class="muted">People</span>
        {#each team.slice(0, 8) as p (p.name)}
          <button
            class="person"
            class:on={person === p.name}
            aria-pressed={person === p.name}
            title="{p.name}: {p.commits} commit{p.commits === 1 ? '' : 's'}. Click to highlight."
            onclick={() => (person = person === p.name ? null : p.name)}
          >
            <span class="avatar">{p.initials}</span>{p.name}<span class="muted">{p.commits}</span>
          </button>
        {/each}
        {#if team.length > 8}<span class="muted">+{team.length - 8} more</span>{/if}
      </div>
    {/if}

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

    <!-- A keyboard-navigable diagram (arrow keys move between commits): role="application" is the
         right ARIA role for that, though Svelte only treats native controls and widget roles as interactive. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="canvas"
      bind:this={scroller}
      tabindex="0"
      role="application"
      aria-label="Branch map. Arrow keys move between commits, Escape closes."
      onscroll={() => (hovered = null)}
      onkeydown={onKey}
    >
      <svg {width} {height} role="img" aria-label="Branch map of {repo.root}">
        {#each { length: graph.rows } as _, row (row)}
          <line x1="0" x2={width} y1={TOP + row * ROW_H} y2={TOP + row * ROW_H} class="guide" />
        {/each}

        {#each display.edges as edge (edge.from + ">" + edge.to)}
          <path
            d={edgePath(edge)}
            class="map-edge"
            class:dashed={incoming.has(edge.from)}
            class:dim={hoveredLane !== null && edgeLane(edge) !== hoveredLane}
            style="stroke: {laneColor(graph.lanes[edgeLane(edge)].color)}"
          />
        {/each}

        {#each laneLabels as label (label.laneIndex)}
          <text
            class="lane-label"
            class:dim={hoveredLane !== null && hoveredLane !== label.laneIndex}
            x={x(label.node)}
            y={y(label.node) + R + 18}
            text-anchor="middle"
            style="fill: {laneColor(label.lane.color)}"
          >
            {label.lane.name}{label.lane.kind === "merged" ? " (merged)" : ""}
          </text>
        {/each}

        {#each display.nodes as node (node.id)}
          {@const color = laneColor(laneOf(node).color)}
          {#if node.kind === "group"}
            <g
              class="map-group"
              class:dim={dimmed(node)}
              role="button"
              tabindex="-1"
              aria-label="{node.indices.length} more commits on {laneOf(node).name}. Click to show them."
              onclick={() => expand(node)}
              onkeydown={(e) => e.key === "Enter" && expand(node)}
              onpointerenter={() => (hoveredLane = node.lane)}
              onpointerleave={() => (hoveredLane = null)}
            >
              <rect x={x(node) - 17} y={y(node) - 10} width="34" height="20" rx="10" style="stroke: {color}" />
              <text x={x(node)} y={y(node) + 4} text-anchor="middle" style="fill: {color}">+{node.indices.length}</text>
            </g>
          {:else}
            {@const commit = commitOf(node)}
            {@const isHead = commit.hash === repo.status.oid}
            <g
              class="map-node"
              class:selected={selected === commit.hash}
              class:faded={incoming.has(commit.hash)}
              class:dim={dimmed(node)}
              class:hit={hits.has(commit.hash)}
              role="button"
              tabindex="-1"
              aria-label="{commit.subject}, {commit.hash.slice(0, 7)}, by {commit.author}"
              onclick={() => select(commit.hash)}
              onkeydown={(e) => (e.key === "Enter" || e.key === " ") && select(commit.hash)}
              oncontextmenu={(e) => {
                e.preventDefault();
                openCommitMenu(commit, at(e));
              }}
              onpointerenter={() => {
                hovered = { commit, x: x(node), y: y(node) };
                hoveredLane = node.lane;
              }}
              onpointerleave={() => {
                hovered = null;
                hoveredLane = null;
              }}
            >
              {#if isHead}<circle cx={x(node)} cy={y(node)} r={R + 6} class="map-halo" style="stroke: {color}" />{/if}
              <circle cx={x(node)} cy={y(node)} r={R + 3.5} class="map-ring" />
              <circle
                cx={x(node)}
                cy={y(node)}
                r={R}
                class="map-dot"
                class:hollow={unpushed.has(commit.hash)}
                style="fill: {color}; stroke: {color}"
              />
              {#if R >= 10}
                <text
                  class="initials"
                  class:on-hollow={unpushed.has(commit.hash)}
                  x={x(node)}
                  y={y(node) + 3.5}
                  text-anchor="middle">{initials(commit.author)}</text
                >
              {/if}
              <!-- Branch and tag flags above the commit they point at, stacked if several. -->
              {#each commit.refs as ref, k (ref.kind + ref.name)}
                {@const chip = refColor(graph, ref) ?? "var(--vscode-charts-yellow)"}
                {@const label = ref.kind === "tag" ? `🏷 ${ref.name}` : ref.name}
                {@const w = label.length * 6.4 + 12}
                {@const branch = ref.kind === "local" && localBranches.has(ref.name) ? ref.name : null}
                <g
                  class="flag flag-{ref.kind}"
                  class:draggable={!!branch}
                  class:drop-target={!!branch && drag?.active && drag.branch !== branch}
                  class:drop-over={!!branch && drag?.active && drag.over === branch}
                  class:current={branch !== null && branch === current}
                  transform="translate({x(node) - w / 2}, {y(node) - R - 26 - k * 20})"
                  data-branch={branch}
                  role={branch ? "button" : "presentation"}
                  aria-label={branch
                    ? `Branch ${branch}. Click for actions, drag onto another branch to merge or rebase.`
                    : undefined}
                  onpointerdown={(e) => branch && startDrag(e, branch)}
                  onpointerenter={() => {
                    if (drag && branch && drag.branch !== branch) drag = { ...drag, over: branch };
                  }}
                  onpointerleave={() => {
                    if (drag && drag.over === branch) drag = { ...drag, over: null };
                  }}
                >
                  <rect width={w} height="16" rx="3" style="--chip: {chip}" />
                  <text x={w / 2} y="11.5" text-anchor="middle">{label}</text>
                </g>
              {/each}
            </g>
          {/if}
        {/each}
      </svg>

      {#if hovered && !drag?.active}
        {@const scrollLeft = scroller?.scrollLeft ?? 0}
        <div class="tooltip" style="left: {hovered.x - scrollLeft}px; top: {hovered.y + R + 30}px">
          <b>{hovered.commit.subject}</b>
          <span class="muted"
            >{hovered.commit.hash.slice(0, 7)} · {hovered.commit.author} · {ago(hovered.commit.time)}</span
          >
          {#if unpushed.has(hovered.commit.hash)}<span class="muted">Not pushed yet</span>{/if}
          {#if incoming.has(hovered.commit.hash)}<span class="muted">On the remote, not pulled yet</span>{/if}
          <span class="muted hint-line">Right-click for actions</span>
        </div>
      {/if}

      {#if menu}
        <Menu {...menu} onClose={() => (menu = null)} />
      {/if}
    </div>

    {#if drag?.active}
      <div class="drag-ghost" style="left: {drag.x + 12}px; top: {drag.y + 12}px">
        <span class="codicon codicon-git-branch"></span>{drag.branch}{drag.over ? ` → ${drag.over}` : ""}
      </div>
    {/if}

    <footer class="map-hint muted">
      {compact ? "Quiet stretches are folded into +N; click one to open it. " : ""}Click a branch name for actions, or
      drag it onto another branch to merge or rebase.
    </footer>

    {#if selectedCommit}
      <div class="map-panel">
        <CommitPanel {repo} commit={selectedCommit} {details} {busy} {send} onClose={() => (selected = null)} />
      </div>
    {/if}
  {/if}
</main>
