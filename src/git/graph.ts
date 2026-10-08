import type { Commit, GraphLine, GraphRow } from "../shared/types";

/**
 * Assigns each commit a lane and computes the line segments for every row.
 * Expects commits in topological order (children before parents), as `git log --topo-order` gives.
 * Each lane holds the hash of the commit it is waiting to reach, or null if free.
 */
export function layoutGraph(commits: readonly Commit[]): { rows: GraphRow[]; lanes: number } {
  let lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let maxLanes = 0;

  for (const commit of commits) {
    // Snapshot before placing a tip, so a tip gets no line coming in from above.
    const before = lanes.slice();
    const freedHere = new Set<number>();
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      // Nothing points here yet: a branch tip.
      lane = firstFree(lanes);
      lanes[lane] = commit.hash;
    }

    const after = before.map((hash, i) => {
      if (hash !== commit.hash) return hash;
      if (i !== lane) freedHere.add(i);
      return null;
    });

    const parentLanes = commit.parents.map((parent, i) => {
      // The first parent always continues straight down, so a branch keeps its lane even when
      // another lane already waits for the same parent; the lanes converge at that commit.
      if (i === 0) {
        after[lane] = parent;
        return lane;
      }
      const existing = after.indexOf(parent);
      if (existing !== -1) return existing;
      // Don't reuse a lane that merged into this commit: the new branch would look like its continuation.
      const target = firstFree(after, freedHere);
      after[target] = parent;
      return target;
    });

    const lines: GraphLine[] = [];
    before.forEach((hash, i) => {
      if (hash === null) return;
      if (hash === commit.hash) lines.push({ x1: i, y1: 0, x2: lane, y2: 1, lane: i });
      else lines.push({ x1: i, y1: 0, x2: i, y2: 2, lane: i });
    });
    for (const target of parentLanes) {
      lines.push({ x1: lane, y1: 1, x2: target, y2: 2, lane: target });
    }

    while (after.length > 0 && after[after.length - 1] === null) after.pop();
    maxLanes = Math.max(maxLanes, before.length, after.length, lane + 1);
    rows.push({ commit, lane, lines });
    lanes = after;
  }

  return { rows, lanes: maxLanes };
}

function firstFree(lanes: readonly (string | null)[], exclude: ReadonlySet<number> = new Set()): number {
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] === null && !exclude.has(i)) return i;
  }
  return lanes.length;
}
