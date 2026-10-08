import type { BranchGraph, Commit, GraphEdge, Lane } from "../shared/types";

// Lays commits out by branch, the way people draw git on a whiteboard: the main branch is one
// straight lane, every other branch gets its own lane that forks off and merges back.
//
// Git doesn't record which branch a commit was made on, so ownership is inferred:
//  1. Branches claim commits by walking first parents from their tips, most important first
//     (main, then develop, then the current branch, then the newest). A walk stops at the first
//     commit someone else already claimed: that's where the branch forked.
//  2. Commits brought in by a merge whose branch no longer exists get a lane named from the
//     merge message ("Merge branch 'feat/ui'"), so merged work stays visible.
//  3. Lanes that don't overlap in time share a row, so the picture stays compact.

const MERGE_PATTERNS = [
  /^Merge branch '([^']+)'/,
  /^Merge pull request #\d+ from [^/\s]+\/(\S+)/,
  /^Merge remote-tracking branch '[^/']+\/([^']+)'/,
];

const SECONDARY_BASES = ["develop", "dev"];

export function mergedBranchName(subject: string): string | null {
  for (const pattern of MERGE_PATTERNS) {
    const match = pattern.exec(subject);
    if (match) return match[1];
  }
  return null;
}

export function layoutBranches(
  commits: readonly Commit[],
  options: { base: string | null; head: string | null },
): BranchGraph {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const laneOf: number[] = commits.map(() => -1);
  const lanes: Omit<Lane, "row" | "color">[] = [];

  const claim = (start: number, lane: number): number => {
    let claimed = 0;
    let i: number | undefined = start;
    while (i !== undefined && laneOf[i] === -1) {
      laneOf[i] = lane;
      claimed++;
      const parent: string | undefined = commits[i].parents[0];
      i = parent === undefined ? undefined : index.get(parent);
    }
    return claimed;
  };

  const addLane = (name: string, kind: Lane["kind"], tips: number[]) => {
    const id = lanes.length;
    lanes.push({ name, kind });
    const claimed = tips.reduce((sum, tip) => sum + claim(tip, id), 0);
    // A branch with no commits of its own (e.g. just created) is only a label on another lane.
    if (claimed === 0) lanes.pop();
  };

  // Local "x" and remote "origin/x" are the same branch: one lane, so incoming commits sit in line.
  const tips = new Map<string, number[]>();
  commits.forEach((commit, i) => {
    for (const ref of commit.refs) {
      if (ref.kind === "tag") continue;
      const name = ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name;
      const list = tips.get(name) ?? [];
      list.push(i);
      tips.set(name, list);
    }
  });

  const order = [...tips.keys()].sort(
    (a, b) => rank(a) - rank(b) || Math.min(...tips.get(a)!) - Math.min(...tips.get(b)!),
  );
  function rank(name: string): number {
    if (name === options.base) return 0;
    if (SECONDARY_BASES.includes(name)) return 1;
    if (name === options.head) return 2;
    return 3;
  }
  for (const name of order) addLane(name, name === options.base ? "base" : "branch", tips.get(name)!);

  // Newest to oldest, so a merge is always seen before the commits it brought in.
  commits.forEach((commit, i) => {
    if (laneOf[i] === -1) {
      const tag = commit.refs.find((r) => r.kind === "tag")?.name;
      addLane(tag ?? "detached", "other", [i]);
    }
    commit.parents.slice(1).forEach((parent) => {
      const p = index.get(parent);
      if (p !== undefined && laneOf[p] === -1) addLane(mergedBranchName(commit.subject) ?? "merged", "merged", [p]);
    });
  });

  // Oldest commit is column 0. Topological order guarantees parents get smaller columns.
  const placement = commits.map((_, i) => ({ lane: laneOf[i], column: commits.length - 1 - i }));

  const edges: GraphEdge[] = [];
  commits.forEach((commit, child) => {
    commit.parents.forEach((hash, k) => {
      const parent = index.get(hash);
      if (parent === undefined) return; // Beyond the loaded history.
      const kind = k > 0 ? "merge" : laneOf[parent] === laneOf[child] ? "line" : "fork";
      edges.push({ child, parent, kind });
    });
  });

  const rows = packRows(lanes.length, placement, edges, (id) => lanes[id].kind === "base");
  const withRows: Lane[] = lanes.map((lane, id) => ({
    ...lane,
    row: rows[id],
    // The base keeps colour 0; others cycle through the rest so neighbours rarely match.
    color: lane.kind === "base" ? 0 : 1 + ((id - (lanes[0]?.kind === "base" ? 1 : 0)) % 5),
  }));

  return {
    commits: [...commits],
    lanes: withRows,
    placement,
    edges,
    rows: withRows.reduce((max, lane) => Math.max(max, lane.row + 1), 0),
  };
}

/** Assigns each lane a row: the base gets row 0, others the first row where they don't overlap in time. */
function packRows(
  laneCount: number,
  placement: readonly { lane: number; column: number }[],
  edges: readonly GraphEdge[],
  isBase: (lane: number) => boolean,
): number[] {
  const span = Array.from({ length: laneCount }, () => ({ from: Infinity, to: -Infinity }));
  const extend = (lane: number, column: number) => {
    span[lane].from = Math.min(span[lane].from, column);
    span[lane].to = Math.max(span[lane].to, column);
  };
  placement.forEach((p) => extend(p.lane, p.column));
  // A lane also occupies its row from the fork point and up to where it merges back.
  for (const edge of edges) {
    if (edge.kind === "fork") extend(placement[edge.child].lane, placement[edge.parent].column);
    if (edge.kind === "merge") extend(placement[edge.parent].lane, placement[edge.child].column);
  }

  const taken: { from: number; to: number }[][] = [];
  const rows: number[] = [];
  // Row 0 belongs to the base; without one, every row is up for grabs.
  const firstFree = Array.from({ length: laneCount }, (_, lane) => lane).some(isBase) ? 1 : 0;
  for (let lane = 0; lane < laneCount; lane++) {
    let row = isBase(lane) ? 0 : firstFree;
    if (!isBase(lane)) {
      while (taken[row]?.some((s) => s.from <= span[lane].to + 1 && span[lane].from <= s.to + 1)) row++;
    }
    (taken[row] ??= []).push(span[lane]);
    rows.push(row);
  }
  return rows;
}
