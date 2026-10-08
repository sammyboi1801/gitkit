import { describe, expect, it } from "vitest";
import { isValidBranchName, planAction, type PlanResult } from "../../src/git/actions";
import type { BaseInfo, FileChange, RepoState, StatusInfo } from "../../src/shared/types";

const repo = (status: Partial<StatusInfo> = {}, remotes = ["origin"]): RepoState => ({
  root: "/repo",
  status: { branch: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0, files: [], ...status },
  remotes,
  stashCount: 0,
  graph: { commits: [], lanes: [], placement: [], edges: [], rows: 0 },
  unpushed: [],
  incoming: [],
  base: null,
  lastFetch: null,
  operation: null,
  activity: [],
});

const file = (path: string, change: Partial<FileChange> = {}): FileChange => ({
  path,
  index: null,
  worktree: "M",
  untracked: false,
  conflicted: false,
  ...change,
});

const steps = (result: PlanResult) => (result.ok ? result.plan.steps : result.reason);

describe("planAction", () => {
  it("publishes a branch that has no upstream", () => {
    expect(steps(planAction({ type: "push" }, repo({ branch: "feat/x", upstream: null })))).toEqual([
      ["push", "-u", "origin", "feat/x"],
    ]);
  });

  it("refuses to push without a remote or on a detached HEAD", () => {
    expect(planAction({ type: "push" }, repo({ upstream: null }, [])).ok).toBe(false);
    expect(planAction({ type: "push" }, repo({ branch: null })).ok).toBe(false);
  });

  it("commits staged changes only when something is staged", () => {
    const staged = repo({ files: [file("a.py", { index: "M", worktree: null }), file("b.py")] });
    expect(steps(planAction({ type: "commit", message: "fix" }, staged))).toEqual([["commit", "-m", "fix"]]);
  });

  it("stages everything first when nothing is staged", () => {
    const result = planAction({ type: "commit", message: "fix" }, repo({ files: [file("b.py")] }));
    expect(result.ok && result.plan.label).toBe("Commit all");
    expect(steps(result)).toEqual([
      ["add", "-A"],
      ["commit", "-m", "fix"],
    ]);
  });

  it("blocks empty messages and unresolved conflicts", () => {
    expect(planAction({ type: "commit", message: "  " }, repo({ files: [file("a")] })).ok).toBe(false);
    const conflicted = repo({ files: [file("a", { conflicted: true, index: "U" })] });
    expect(planAction({ type: "commit", message: "x" }, conflicted).ok).toBe(false);
  });

  it("discards by stashing, with a confirmation", () => {
    const result = planAction({ type: "discard", paths: ["app.py"] }, repo());
    expect(result.ok && result.plan.confirm).toBeTruthy();
    expect(steps(result)).toEqual([
      ["stash", "push", "--include-untracked", "-m", "GitKit discard: app.py", "--", "app.py"],
    ]);
  });

  it("unstages with rm --cached before the first commit", () => {
    expect(steps(planAction({ type: "unstage", paths: ["a"] }, repo({ oid: null })))).toEqual([
      ["rm", "--cached", "-q", "--", "a"],
    ]);
  });

  it("only fast-forwards on pull, and rebases on sync", () => {
    expect(steps(planAction({ type: "pull" }, repo()))).toEqual([["pull", "--ff-only"]]);
    expect(steps(planAction({ type: "sync" }, repo()))).toEqual([["pull", "--rebase", "--autostash"], ["push"]]);
  });

  it("switches and creates branches, validating names", () => {
    expect(steps(planAction({ type: "switch", branch: "dev" }, repo()))).toEqual([["switch", "dev"]]);
    expect(planAction({ type: "switch", branch: "main" }, repo()).ok).toBe(false);
    expect(steps(planAction({ type: "createBranch", name: "feat/x", from: "abc" }, repo()))).toEqual([
      ["switch", "-c", "feat/x", "abc"],
    ]);
    expect(planAction({ type: "createBranch", name: "bad name" }, repo()).ok).toBe(false);
  });

  it("reverts and cherry-picks only on a clean tree, with confirmation", () => {
    const revert = planAction({ type: "revert", hash: "abcdef123" }, repo());
    expect(revert.ok && revert.plan.confirm).toBeTruthy();
    expect(steps(revert)).toEqual([["revert", "--no-edit", "abcdef123"]]);
    expect(planAction({ type: "cherryPick", hash: "abc" }, repo({ files: [file("a")] })).ok).toBe(false);
    // Untracked files don't block either.
    expect(planAction({ type: "cherryPick", hash: "abc" }, repo({ files: [file("n", { untracked: true })] })).ok).toBe(
      true,
    );
  });
});

describe("isValidBranchName", () => {
  it("accepts normal names and rejects git-invalid ones", () => {
    for (const ok of ["main", "feat/login", "fix-123", "v1.2"]) expect(isValidBranchName(ok)).toBe(true);
    for (const bad of ["", "@", "a b", "a..b", "-x", "x/", "x.lock", "a~1", "a:b", "a//b", "@{x}"])
      expect(isValidBranchName(bad)).toBe(false);
  });
});

describe("updateFromBase", () => {
  const base = (info: Partial<BaseInfo> = {}): BaseInfo => ({
    ref: "origin/main",
    name: "main",
    ahead: 2,
    behind: 3,
    forkPoint: "f0",
    conflicts: [],
    isCurrent: false,
    ...info,
  });
  const withBase = (info: Partial<BaseInfo>, status: Partial<StatusInfo> = {}) => ({
    ...repo({ branch: "feat/x", ...status }),
    base: base(info),
  });

  it("merges into a published branch, after saving a backup", () => {
    const result = planAction({ type: "updateFromBase" }, withBase({}));
    expect(result.ok && result.plan.label).toBe("Merge main");
    expect(steps(result)).toEqual([
      ["update-ref", "refs/gitkit/backup/feat/x", "HEAD"],
      ["merge", "--autostash", "--no-edit", "origin/main"],
    ]);
  });

  it("rebases a branch that isn't published yet", () => {
    const result = planAction({ type: "updateFromBase" }, withBase({}, { upstream: null }));
    expect(result.ok && result.plan.label).toBe("Rebase on main");
    expect(steps(result)).toContainEqual(["rebase", "--autostash", "origin/main"]);
  });

  it("warns about predicted conflicts in the confirmation", () => {
    const result = planAction({ type: "updateFromBase" }, withBase({ conflicts: ["app.py"] }));
    expect(result.ok && result.plan.confirm).toContain("app.py");
  });

  it("does nothing when already up to date or mid-operation", () => {
    expect(planAction({ type: "updateFromBase" }, withBase({ behind: 0 })).ok).toBe(false);
    expect(planAction({ type: "updateFromBase" }, { ...withBase({}), operation: "rebase" }).ok).toBe(false);
  });
});

describe("continue and abort", () => {
  it("continues without opening an editor, once conflicts are staged", () => {
    const rebasing = { ...repo(), operation: "rebase" as const };
    expect(steps(planAction({ type: "continueOperation" }, rebasing))).toEqual([
      ["-c", "core.editor=true", "rebase", "--continue"],
    ]);
    const merging = { ...repo(), operation: "merge" as const };
    expect(steps(planAction({ type: "continueOperation" }, merging))).toEqual([["commit", "--no-edit"]]);
    const stuck = { ...repo({ files: [file("a", { conflicted: true })] }), operation: "merge" as const };
    expect(planAction({ type: "continueOperation" }, stuck).ok).toBe(false);
  });

  it("aborts with a confirmation", () => {
    const result = planAction({ type: "abortOperation" }, { ...repo(), operation: "cherry-pick" });
    expect(result.ok && result.plan.confirm).toBeTruthy();
    expect(steps(result)).toEqual([["cherry-pick", "--abort"]]);
  });
});
