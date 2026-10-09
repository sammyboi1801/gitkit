import { describe, expect, it } from "vitest";
import { compactGraph } from "../../src/git/compact";
import { layoutBranches } from "../../src/git/lanes";
import type { Commit, Ref } from "../../src/shared/types";

const c = (hash: string, parents: string[], refs: Ref[] = [], subject = hash): Commit => ({
  hash,
  parents,
  author: "Sam",
  time: 0,
  subject,
  refs,
});
const main: Ref = { name: "main", kind: "local", isHead: true };

/** main: c9 … c0, a straight line of ten commits. */
const linear = Array.from({ length: 10 }, (_, k) => {
  const n = 9 - k;
  return c(`c${n}`, n ? [`c${n - 1}`] : [], n === 9 ? [main] : []);
});

const show = (graph: ReturnType<typeof compactGraph>) =>
  graph.nodes.map((n) => (n.kind === "group" ? `+${n.indices.length}` : n.id));

describe("compactGraph", () => {
  const graph = layoutBranches(linear, { base: "main", head: "main" });

  it("shows everything when compact mode is off", () => {
    const full = compactGraph(graph, { compact: false, keep: new Set() });
    expect(full.nodes).toHaveLength(10);
    expect(full.columns).toBe(10);
  });

  it("collapses a straight run into one group, keeping the start and the tip", () => {
    const compact = compactGraph(graph, { compact: true, keep: new Set() });
    expect(show(compact)).toEqual(["c0", "+8", "c9"]);
    expect(compact.edges).toHaveLength(2);
    expect(compact.edges).toEqual(
      expect.arrayContaining([
        { from: "group:c1", to: "c0", kind: "line" },
        { from: "c9", to: "group:c1", kind: "line" },
      ]),
    );
  });

  it("keeps whatever the caller needs visible, splitting the run around it", () => {
    const compact = compactGraph(graph, { compact: true, keep: new Set(["c5"]) });
    expect(show(compact)).toEqual(["c0", "+4", "c5", "+3", "c9"]);
  });

  it("never makes a group of one", () => {
    // c9 c8 c7, with c7 as the root: c8 alone sits between the start and the tip.
    const three = linear.slice(0, 3).map((x) => (x.hash === "c7" ? { ...x, parents: [] } : x));
    const compact = compactGraph(layoutBranches(three, { base: "main", head: "main" }), {
      compact: true,
      keep: new Set(),
    });
    expect(show(compact)).toEqual(["c7", "c8", "c9"]);
  });

  it("keeps forks and merges, so branches still visibly split and join", () => {
    const branched = layoutBranches(
      [
        c("m", ["b3", "f2"], [main], "Merge branch 'feat'"),
        c("f2", ["f1"]),
        c("f1", ["b1"]),
        c("b3", ["b2"]),
        c("b2", ["b1"]),
        c("b1", ["b0"]),
        c("b0", []),
      ],
      { base: "main", head: "main" },
    );
    const compact = compactGraph(branched, { compact: true, keep: new Set() });
    // b0 starts main, b1 is where feat forks off, f1 starts feat, f2 is merged into m.
    // Main's own commits between the fork and the merge (b2, b3) collapse.
    expect(show(compact)).toEqual(["b0", "b1", "+2", "f1", "f2", "m"]);
  });
});
