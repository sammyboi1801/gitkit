import type { BranchGraph } from "../shared/types";

// Compact view of a branch graph for long histories: on each lane, runs of commits where nothing
// happens (no branch or tag points there, nothing forks or merges) collapse into one "+N" node.
// What stays: lane starts and tips, forks, merges, refs, and anything the caller asks to keep.

export type DisplayNode =
  | { kind: "commit"; id: string; index: number; lane: number; column: number }
  | { kind: "group"; id: string; indices: number[]; lane: number; column: number };

export interface DisplayEdge {
  /** Newer end (child), then older end (parent). */
  from: string;
  to: string;
  kind: "line" | "fork" | "merge";
}

export interface DisplayGraph {
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  columns: number;
}

export interface CompactOptions {
  compact: boolean;
  /** Hashes that must stay visible: HEAD, the selection, search matches, expanded groups. */
  keep: ReadonlySet<string>;
}

export function compactGraph(graph: BranchGraph, options: CompactOptions): DisplayGraph {
  const { commits, placement, edges } = graph;
  const important = new Array<boolean>(commits.length).fill(!options.compact);

  if (options.compact) {
    const seenLane = new Set<number>();
    commits.forEach((commit, i) => {
      const isTip = !seenLane.has(placement[i].lane); // Newest first: first seen is the tip.
      seenLane.add(placement[i].lane);
      if (isTip || commit.refs.length || commit.parents.length !== 1 || options.keep.has(commit.hash))
        important[i] = true;
    });
    for (const edge of edges) {
      // Both ends of a fork or merge show where branches meet.
      if (edge.kind !== "line") important[edge.child] = important[edge.parent] = true;
    }
    // Each lane's oldest commit shows where the lane starts.
    const oldest = new Map<number, number>();
    placement.forEach((p, i) => oldest.set(p.lane, i));
    for (const i of oldest.values()) important[i] = true;
  }

  // Oldest first, so columns read left to right in time.
  const order = commits.map((_, i) => i).sort((a, b) => placement[a].column - placement[b].column);
  const nodes: DisplayNode[] = [];
  const nodeOf: string[] = [];
  const open = new Map<number, Extract<DisplayNode, { kind: "group" }>>();
  let column = 0;

  for (const i of order) {
    const lane = placement[i].lane;
    if (important[i]) {
      open.delete(lane);
      const id = commits[i].hash;
      nodes.push({ kind: "commit", id, index: i, lane, column: column++ });
      nodeOf[i] = id;
      continue;
    }
    let group = open.get(lane);
    if (!group) {
      group = { kind: "group", id: `group:${commits[i].hash}`, indices: [], lane, column: column++ };
      open.set(lane, group);
      nodes.push(group);
    }
    group.indices.push(i);
    nodeOf[i] = group.id;
  }

  // A "group" of one commit saves nothing; show the commit itself.
  for (const [n, node] of nodes.entries()) {
    if (node.kind === "group" && node.indices.length === 1) {
      const index = node.indices[0];
      nodes[n] = { kind: "commit", id: commits[index].hash, index, lane: node.lane, column: node.column };
      nodeOf[index] = commits[index].hash;
    }
  }

  const seen = new Set<string>();
  const displayEdges: DisplayEdge[] = [];
  for (const edge of edges) {
    const from = nodeOf[edge.child];
    const to = nodeOf[edge.parent];
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    displayEdges.push({
      from,
      to,
      kind: placement[edge.child].lane === placement[edge.parent].lane ? "line" : edge.kind,
    });
  }

  return { nodes, edges: displayEdges, columns: column };
}
