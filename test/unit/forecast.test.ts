import { describe, expect, it, vi } from "vitest";
import { commit, git, makeRepo } from "../fixtures/repos";

// Every git command GitKit runs, so the test can count the expensive ones.
const commands: string[][] = [];
vi.mock("../../src/git/runner", async (original) => {
  const real = await original<typeof import("../../src/git/runner")>();
  return {
    ...real,
    runGit: (
      args: readonly string[],
      ...rest: Parameters<typeof real.runGit> extends [unknown, ...infer R] ? R : never
    ) => {
      commands.push([...args]);
      return real.runGit(args, ...rest);
    },
  };
});

const { predictConflicts } = await import("../../src/git/repo");
const mergeTrees = () => commands.filter((c) => c.includes("merge-tree")).length;

describe("predictConflicts", () => {
  it("test-merges each pair of commits once, and again only when either side moves", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "feat");
    commit(dir, "theirs", { "a.txt": "theirs\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "ours", { "a.txt": "ours\n" });

    expect(await predictConflicts(dir, "feat")).toEqual(["a.txt"]);
    expect(await predictConflicts(dir, "feat")).toEqual(["a.txt"]);
    expect(mergeTrees()).toBe(1);

    // A new commit is a new pair: forecast again.
    commit(dir, "ours again", { "b.txt": "b\n" });
    expect(await predictConflicts(dir, "feat")).toEqual(["a.txt"]);
    expect(mergeTrees()).toBe(2);
  });
});
