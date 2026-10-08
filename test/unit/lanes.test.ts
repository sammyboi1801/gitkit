import { describe, expect, it } from "vitest";
import { layoutBranches, mergedBranchName } from "../../src/git/lanes";
import type { Commit, Ref } from "../../src/shared/types";

const local = (name: string, isHead = false): Ref => ({ name, kind: "local", isHead });
const remote = (name: string): Ref => ({ name, kind: "remote", isHead: false });
const tag = (name: string): Ref => ({ name, kind: "tag", isHead: false });

const c = (hash: string, parents: string[], refs: Ref[] = [], subject = hash): Commit => ({
  hash,
  parents,
  author: "Sam",
  time: 0,
  subject,
  refs,
});

/** "hash → lane name" for readable assertions. */
function lanesByCommit(commits: Commit[], base = "main", head: string | null = null) {
  const graph = layoutBranches(commits, { base, head });
  return {
    graph,
    laneOf: Object.fromEntries(commits.map((commit, i) => [commit.hash, graph.lanes[graph.placement[i].lane].name])),
  };
}

describe("mergedBranchName", () => {
  it("reads branch names from common merge messages", () => {
    expect(mergedBranchName("Merge branch 'feat/ui'")).toBe("feat/ui");
    expect(mergedBranchName("Merge branch 'feat/ui' into main")).toBe("feat/ui");
    expect(mergedBranchName("Merge pull request #12 from sam/fix-login")).toBe("fix-login");
    expect(mergedBranchName("Merge remote-tracking branch 'origin/dev'")).toBe("dev");
    expect(mergedBranchName("fix: typo")).toBeNull();
  });
});

describe("layoutBranches", () => {
  it("puts linear history on the main lane, in row 0 with colour 0", () => {
    const { graph, laneOf } = lanesByCommit([c("c", ["b"], [local("main", true)]), c("b", ["a"]), c("a", [])]);
    expect(laneOf).toEqual({ c: "main", b: "main", a: "main" });
    expect(graph.lanes).toEqual([{ name: "main", kind: "base", row: 0, color: 0 }]);
    expect(graph.placement.map((p) => p.column)).toEqual([2, 1, 0]);
    expect(graph.edges.every((e) => e.kind === "line")).toBe(true);
  });

  it("gives a deleted, merged branch its own lane named from the merge message", () => {
    const { graph, laneOf } = lanesByCommit([
      c("m", ["b", "f"], [local("main")], "Merge branch 'feat/ui'"),
      c("f", ["a"]),
      c("b", ["a"]),
      c("a", []),
    ]);
    expect(laneOf).toEqual({ m: "main", f: "feat/ui", b: "main", a: "main" });
    const ui = graph.lanes.find((l) => l.name === "feat/ui")!;
    expect(ui).toMatchObject({ kind: "merged", row: 1 });
    expect(graph.edges).toContainEqual({ child: 0, parent: 1, kind: "merge" });
    expect(graph.edges).toContainEqual({ child: 1, parent: 3, kind: "fork" });
  });

  it("keeps an active branch on its own lane, forking off main", () => {
    const { laneOf, graph } = lanesByCommit(
      [c("x", ["b"], [local("feat/login", true)]), c("b", ["a"], [local("main")]), c("a", [])],
      "main",
      "feat/login",
    );
    expect(laneOf).toEqual({ x: "feat/login", b: "main", a: "main" });
    expect(graph.edges).toContainEqual({ child: 0, parent: 1, kind: "fork" });
  });

  it("puts a remote branch's incoming commits on the same lane as the local branch", () => {
    const { laneOf, graph } = lanesByCommit([
      c("r", ["b"], [remote("origin/main")]),
      c("b", ["a"], [local("main", true)]),
      c("a", []),
    ]);
    expect(laneOf).toEqual({ r: "main", b: "main", a: "main" });
    expect(graph.lanes).toHaveLength(1);
  });

  it("claims for main first even when another branch is newer", () => {
    // feat was branched from main's tip and is newer, but main's commits stay on main's lane.
    const { laneOf } = lanesByCommit([c("x", ["b"], [local("feat")]), c("b", ["a"], [local("main")]), c("a", [])]);
    expect(laneOf.b).toBe("main");
    expect(laneOf.x).toBe("feat");
  });

  it("drops lanes for branches with no commits of their own", () => {
    const { graph } = lanesByCommit([c("b", ["a"], [local("main"), local("just-created")]), c("a", [])]);
    expect(graph.lanes.map((l) => l.name)).toEqual(["main"]);
  });

  it("reuses a row for branches that don't overlap in time", () => {
    // Two features merged one after the other: both can sit on row 1.
    const { graph } = lanesByCommit([
      c("m2", ["m1", "g"], [local("main")], "Merge branch 'feat/two'"),
      c("g", ["m1"]),
      c("m1", ["b", "f"], [], "Merge branch 'feat/one'"),
      c("f", ["b"]),
      c("b", ["a"]),
      c("a", []),
    ]);
    const row = (name: string) => graph.lanes.find((l) => l.name === name)!.row;
    expect(row("feat/two")).toBe(1);
    // feat/one ends where feat/two starts (both touch m1), so they're adjacent and must not share.
    expect(row("feat/one")).toBe(2);
    expect(graph.rows).toBe(3);
  });

  it("names tag-only and detached commits instead of dropping them", () => {
    const { laneOf } = lanesByCommit([c("t", ["a"], [tag("experiment")]), c("a", [], [local("main")])]);
    expect(laneOf.t).toBe("experiment");
  });

  it("works without a main branch, leading with the current branch", () => {
    const { graph } = lanesByCommit([c("b", ["a"], [local("trunkless", true)]), c("a", [])], "main", "trunkless");
    expect(graph.lanes[0]).toMatchObject({ name: "trunkless", kind: "branch", row: 0 });
    expect(graph.rows).toBe(1);
  });
});
