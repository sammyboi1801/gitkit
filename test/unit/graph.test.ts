import { describe, expect, it } from "vitest";
import { layoutGraph } from "../../src/git/graph";
import type { Commit } from "../../src/shared/types";

const commit = (hash: string, ...parents: string[]): Commit => ({
  hash,
  parents,
  author: "Sam",
  time: 0,
  subject: hash,
  refs: [],
});

describe("layoutGraph", () => {
  it("keeps linear history in one lane", () => {
    const { rows, lanes } = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
    expect(lanes).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    // The root commit has an incoming line but nothing going down.
    expect(rows[2].lines).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 1, lane: 0 }]);
  });

  it("opens a second lane for a merge and closes it at the fork point", () => {
    //   m        merge of b (main) and f (feature)
    //   |\
    //   | f
    //   b |
    //   |/
    //   a
    const { rows, lanes } = layoutGraph([commit("m", "b", "f"), commit("f", "a"), commit("b", "a"), commit("a")]);
    expect(lanes).toBe(2);
    expect(rows.map((r) => [r.commit.hash, r.lane])).toEqual([
      ["m", 0],
      ["f", 1],
      ["b", 0],
      ["a", 0],
    ]);
    // The merge sends one line straight down and one curving into lane 1.
    expect(rows[0].lines).toContainEqual({ x1: 0, y1: 1, x2: 1, y2: 2, lane: 1 });
    // At the fork point both lanes converge into the same node.
    expect(rows[3].lines).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: 1, lane: 0 },
      { x1: 1, y1: 0, x2: 0, y2: 1, lane: 1 },
    ]);
  });

  it("gives separate branch tips their own lanes", () => {
    const { rows } = layoutGraph([commit("x", "a"), commit("y", "a"), commit("a")]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
  });
});
