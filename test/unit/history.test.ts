import { describe, expect, it } from "vitest";
import { deletedBranches, parseHistory, parseStashes, undoableCount } from "../../src/git/history";

const line = (hash: string, time: number, subject: string) => `${hash}\x1fHEAD@{${time}}\x1f${subject}`;

describe("parseHistory", () => {
  it("describes common reflog entries in plain English, each knowing what came before", () => {
    const entries = parseHistory(
      [
        line("h5", 50, "commit (amend): fix typo"),
        line("h4", 40, "reset: moving to HEAD~1"),
        line("h3", 30, "checkout: moving from main to feat/x"),
        line("h2", 20, "merge feat/ui: Merge made by the 'ort' strategy."),
        line("h1", 10, "commit (initial): first"),
      ].join("\n"),
    );
    expect(entries.map((e) => [e.kind, e.summary, e.before])).toEqual([
      ["amend", 'Amended "fix typo"', "h4"],
      ["reset", "Went back to HEAD~1", "h3"],
      ["checkout", "Switched main → feat/x", "h2"],
      ["merge", "Merged feat/ui", "h1"],
      ["commit", 'Committed "first"', null],
    ]);
    expect(entries[2]).toMatchObject({ from: "main", to: "feat/x" });
  });

  it("names where a reset went by that commit's message, not its hash", () => {
    const entries = parseHistory(`${line("h4", 40, "reset: moving to a9401b2")}\x1ffeat: seed the product list`);
    expect(entries[0].summary).toBe('Went back to "feat: seed the product list"');
  });

  it("collapses a whole rebase into one entry whose 'before' is the state before it started", () => {
    const entries = parseHistory(
      [
        line("r3", 30, "rebase (finish): returning to refs/heads/feat/x"),
        line("r2", 29, "rebase (pick): add login"),
        line("r1", 28, "rebase (start): checkout origin/main"),
        line("h0", 10, "commit: work"),
      ].join("\n"),
    );
    expect(entries).toEqual([
      { hash: "r3", before: "h0", time: 30, kind: "rebase", summary: "Rebased feat/x onto origin/main" },
      { hash: "h0", before: null, time: 10, kind: "commit", summary: 'Committed "work"' },
    ]);
  });

  it("recognises fast-forwards and pulls", () => {
    const entries = parseHistory(
      [line("b", 2, "pull: Fast-forward"), line("a", 1, "merge main: Fast-forward")].join("\n"),
    );
    expect(entries.map((e) => e.summary)).toEqual(["Pulled from the remote", "Fast-forwarded to main"]);
  });
});

describe("undoableCount", () => {
  it("stops at the most recent checkout, which itself can be undone by switching back", () => {
    const entries = parseHistory(
      [
        line("c", 3, "commit: two"),
        line("b", 2, "commit: one"),
        line("a", 1, "checkout: moving from main to x"),
        line("z", 0, "commit: older"),
      ].join("\n"),
    );
    expect(undoableCount(entries)).toBe(3);
  });
});

describe("deletedBranches", () => {
  it("finds branches seen in checkouts that no longer exist, with their last commit", () => {
    const entries = parseHistory(
      [
        line("m2", 4, "checkout: moving from old-feature to main"),
        line("f2", 3, "commit: finish feature"),
        line("f1", 2, "checkout: moving from main to old-feature"),
        line("m1", 1, "commit: base"),
      ].join("\n"),
    );
    expect(deletedBranches(entries, new Set(["main"]))).toEqual([{ name: "old-feature", hash: "f2", time: 4 }]);
    expect(deletedBranches(entries, new Set(["main", "old-feature"]))).toEqual([]);
  });
});

describe("parseStashes", () => {
  it("reads branch and message, and spots GitKit's own discards", () => {
    const out = [
      "stash@{0}\x1fs0\x1f100\x1fOn feat/x: GitKit discard: app.py",
      "stash@{1}\x1fs1\x1f50\x1fWIP on main: abc1234 some commit",
    ].join("\n");
    expect(parseStashes(out)).toEqual([
      { ref: "stash@{0}", hash: "s0", time: 100, branch: "feat/x", message: "GitKit discard: app.py", byGitKit: true },
      { ref: "stash@{1}", hash: "s1", time: 50, branch: "main", message: "abc1234 some commit", byGitKit: false },
    ]);
  });
});
