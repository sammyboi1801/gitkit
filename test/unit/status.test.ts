import { describe, expect, it } from "vitest";
import { parseStatus } from "../../src/git/status";

const z = (...records: string[]) => records.join("\0") + "\0";

describe("parseStatus", () => {
  it("reads branch, upstream and ahead/behind", () => {
    const info = parseStatus(
      z(
        "# branch.oid 2b47825aa",
        "# branch.head feat/login",
        "# branch.upstream origin/feat/login",
        "# branch.ab +2 -1",
      ),
    );
    expect(info).toMatchObject({
      oid: "2b47825aa",
      branch: "feat/login",
      upstream: "origin/feat/login",
      ahead: 2,
      behind: 1,
      files: [],
    });
  });

  it("handles a fresh repo and a detached HEAD", () => {
    expect(parseStatus(z("# branch.oid (initial)", "# branch.head main")).oid).toBeNull();
    expect(parseStatus(z("# branch.oid abc", "# branch.head (detached)")).branch).toBeNull();
  });

  it("parses modified, staged, untracked and paths with spaces", () => {
    const { files } = parseStatus(
      z(
        "# branch.oid abc",
        "# branch.head main",
        "1 .M N... 100644 100644 100644 aaa bbb app.py",
        "1 A. N... 000000 100644 100644 000 ccc src/new file.ts",
        "? notes.txt",
      ),
    );
    expect(files).toEqual([
      { path: "app.py", index: null, worktree: "M", untracked: false, conflicted: false },
      { path: "src/new file.ts", index: "A", worktree: null, untracked: false, conflicted: false },
      { path: "notes.txt", index: null, worktree: "?", untracked: true, conflicted: false },
    ]);
  });

  it("parses renames with their original path", () => {
    const { files } = parseStatus(z("2 R. N... 100644 100644 100644 aaa aaa R100 new.py", "old.py"));
    expect(files).toEqual([
      { path: "new.py", origPath: "old.py", index: "R", worktree: null, untracked: false, conflicted: false },
    ]);
  });

  it("marks unmerged entries as conflicted", () => {
    const { files } = parseStatus(z("u UU N... 100644 100644 100644 100644 a b c app.py"));
    expect(files[0]).toMatchObject({ path: "app.py", conflicted: true, conflict: "UU" });
  });

  it("keeps which side deleted or added a conflicted file", () => {
    // From a real modify/delete merge: deleted on main (ours), changed on the branch (theirs).
    const { files } = parseStatus(z("u DU N... 100644 000000 100644 100644 a 0000 c src/old.js"));
    expect(files[0]).toMatchObject({ path: "src/old.js", conflicted: true, conflict: "DU" });
  });
});
