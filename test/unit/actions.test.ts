import { describe, expect, it } from "vitest";
import { isValidBranchName, planAction, type ActionRequest, type PlanResult } from "../../src/git/actions";
import type { BaseInfo, FileChange, RepoState, StatusInfo, WorktreeInfo } from "../../src/shared/types";

const repo = (status: Partial<StatusInfo> = {}, remotes = ["origin"]): RepoState => ({
  root: "/repo",
  status: { branch: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0, files: [], ...status },
  remotes,
  stashes: [],
  history: [],
  graph: { commits: [], lanes: [], placement: [], edges: [], rows: 0 },
  unpushed: [],
  incoming: [],
  base: null,
  lastFetch: null,
  operation: null,
  activity: [],
  worktrees: [],
  worktreeOverlaps: [],
  checkpoints: [],
  removedCheckpoints: [],
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
    expect(planAction({ type: "commit", message: "fix" }, staged)).toMatchObject({ plan: { label: "Commit 1 file" } });
  });

  it("stages everything first when nothing is staged", () => {
    const result = planAction({ type: "commit", message: "fix" }, repo({ files: [file("b.py")] }));
    expect(result.ok && result.plan.label).toBe("Commit 1 file");
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

describe("resolving a whole file", () => {
  const conflicted = (conflict: string) =>
    repo({ files: [file("logo.png", { index: "U", worktree: "U", conflicted: true, conflict })] });

  it("keeps one side's version, or deletes the file, and stages the result", () => {
    expect(steps(planAction({ type: "resolveFile", path: "logo.png", choice: "theirs" }, conflicted("UU")))).toEqual([
      ["checkout", "--theirs", "--", "logo.png"],
      ["add", "--", "logo.png"],
    ]);
    const deleted = planAction({ type: "resolveFile", path: "logo.png", choice: "delete" }, conflicted("UD"));
    expect(steps(deleted)).toEqual([["rm", "-q", "--", "logo.png"]]);
    expect(deleted.ok && deleted.plan.confirm).toMatch(/Delete logo.png\?/);
  });

  it("refuses a side that no longer has the file, or a file with no conflict", () => {
    // DU: deleted by us, so only their version exists.
    expect(planAction({ type: "resolveFile", path: "logo.png", choice: "ours" }, conflicted("DU")).ok).toBe(false);
    expect(planAction({ type: "resolveFile", path: "logo.png", choice: "theirs" }, conflicted("UD")).ok).toBe(false);
    expect(planAction({ type: "resolveFile", path: "other.png", choice: "ours" }, conflicted("UU")).ok).toBe(false);
  });
});

describe("requests from the webview", () => {
  // The webview names branches, commits and stashes; git must never read one as an option.
  const sneaky = "--exec=calc.exe";
  const requests: ActionRequest[] = [
    { type: "switch", branch: sneaky },
    { type: "createBranch", name: "ok", from: sneaky },
    { type: "revert", hash: sneaky },
    { type: "cherryPick", hash: sneaky },
    { type: "moveToNewBranch", name: "ok", keepAt: sneaky, count: 1 },
    { type: "recoverBranch", name: "ok", hash: sneaky },
    { type: "stashApply", ref: sneaky },
    { type: "stashPop", ref: "-q" },
    { type: "stashDrop", ref: "stash@{0} --quiet" },
    { type: "deleteBranches", names: ["old", "-f"] },
    { type: "mergeBranch", branch: sneaky },
    { type: "rebaseOnto", branch: sneaky },
    { type: "switchAndMerge", target: "dev", source: sneaky },
    { type: "switchAndMerge", target: sneaky, source: "dev" },
  ];

  it("refuses anything git could take for an option", () => {
    for (const request of requests) {
      const result = planAction(request, repo());
      expect(result.ok, JSON.stringify(request)).toBe(false);
    }
  });

  it("still plans real branches, commits and stashes", () => {
    expect(steps(planAction({ type: "rebaseOnto", branch: "origin/main" }, repo({ branch: "feat" })))).toEqual([
      ["update-ref", "refs/gitkit/backup/feat", "HEAD"],
      ["rebase", "--autostash", "origin/main"],
    ]);
    expect(steps(planAction({ type: "stashDrop", ref: "stash@{12}" }, repo()))).toEqual([
      ["stash", "drop", "stash@{12}"],
    ]);
    expect(steps(planAction({ type: "revert", hash: "0a1b2c3d" }, repo()))).toEqual([
      ["revert", "--no-edit", "0a1b2c3d"],
    ]);
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

  it("won't pull, push or sync until the merge is finished or aborted", () => {
    const merging = { ...repo({ upstream: "origin/main", ahead: 1, behind: 1 }), operation: "merge" as const };
    for (const type of ["pull", "push", "sync"] as const) {
      expect(planAction({ type }, merging)).toEqual({ ok: false, reason: "Finish or abort the merge first." });
    }
  });

  it("aborts with a confirmation", () => {
    const result = planAction({ type: "abortOperation" }, { ...repo(), operation: "cherry-pick" });
    expect(result.ok && result.plan.confirm).toBeTruthy();
    expect(steps(result)).toEqual([["cherry-pick", "--abort"]]);
  });
});

describe("undo and fix-ups", () => {
  const history = (...entries: Partial<RepoState["history"][number]>[]) =>
    entries.map((e, i) => ({
      hash: `h${i}`,
      before: `h${i + 1}`,
      time: 0,
      kind: "commit" as const,
      summary: `step ${i}`,
      ...e,
    }));
  const commit = (hash: string, parents: string[]) => ({ hash, parents, author: "", time: 0, subject: hash, refs: [] });
  const withHead = (unpushed: boolean, extra: Partial<RepoState> = {}): RepoState => ({
    ...repo({ oid: "h0" }),
    unpushed: unpushed ? ["h0"] : [],
    graph: { commits: [commit("h0", ["h1"]), commit("h1", [])], lanes: [], placement: [], edges: [], rows: 0 },
    ...extra,
  });

  it("goes back with reset --keep, which never throws away uncommitted work", () => {
    const r = { ...withHead(true), history: history({}, {}) };
    const result = planAction({ type: "undoTo", index: 1 }, r);
    expect(steps(result)).toEqual([["reset", "--keep", "h2"]]);
    expect(result.ok && result.plan.confirm).toContain("1 newer step");
  });

  it("undoes a checkout by switching back, and refuses steps from another branch", () => {
    const r = {
      ...withHead(true),
      history: history({}, { kind: "checkout", from: "main", to: "feat" }, { summary: "on main" }),
    };
    expect(steps(planAction({ type: "undoTo", index: 1 }, r))).toEqual([["switch", "main"]]);
    expect(planAction({ type: "undoTo", index: 2 }, r).ok).toBe(false);
  });

  it("only undoes or amends the last commit while it's unpushed", () => {
    expect(steps(planAction({ type: "undoLastCommit" }, withHead(true)))).toEqual([["reset", "--soft", "HEAD~1"]]);
    expect(planAction({ type: "undoLastCommit" }, withHead(false)).ok).toBe(false);
    expect(steps(planAction({ type: "amendMessage", message: "better" }, withHead(true)))).toEqual([
      ["commit", "--amend", "--only", "--allow-empty", "-m", "better"],
    ]);
    expect(planAction({ type: "amendMessage", message: "better" }, withHead(false)).ok).toBe(false);
  });

  it("moves commits to a new branch: branch, step back, switch", () => {
    const result = planAction(
      { type: "moveToNewBranch", name: "feat/right", keepAt: "abc1234", count: 2 },
      withHead(true),
    );
    expect(steps(result)).toEqual([
      ["branch", "feat/right"],
      ["reset", "--keep", "abc1234"],
      ["switch", "feat/right"],
    ]);
  });

  it("won't delete the branch you're on", () => {
    expect(planAction({ type: "deleteBranches", names: ["main"] }, repo()).ok).toBe(false);
    expect(steps(planAction({ type: "deleteBranches", names: ["old"] }, repo()))).toEqual([["branch", "-D", "old"]]);
  });
});

describe("branch-to-branch actions (Branch Map)", () => {
  it("merges another branch into the current one", () => {
    const result = planAction({ type: "mergeBranch", branch: "feat" }, repo());
    expect(result.ok && result.plan.label).toBe("Merge into main");
    expect(steps(result)).toEqual([["merge", "--autostash", "--no-edit", "feat"]]);
    expect(planAction({ type: "mergeBranch", branch: "main" }, repo()).ok).toBe(false);
  });

  it("rebases with a backup, warning when the branch is published", () => {
    const result = planAction(
      { type: "rebaseOnto", branch: "main" },
      repo({ branch: "feat", upstream: "origin/feat" }),
    );
    expect(steps(result)).toEqual([
      ["update-ref", "refs/gitkit/backup/feat", "HEAD"],
      ["rebase", "--autostash", "main"],
    ]);
    expect(result.ok && result.plan.confirm).toMatch(/force-push/);
  });

  it("switches first when merging into a branch you're not on", () => {
    expect(steps(planAction({ type: "switchAndMerge", target: "release", source: "feat" }, repo()))).toEqual([
      ["switch", "release"],
      ["merge", "--autostash", "--no-edit", "feat"],
    ]);
    // Onto the current branch it's a plain merge.
    expect(steps(planAction({ type: "switchAndMerge", target: "main", source: "feat" }, repo()))).toEqual([
      ["merge", "--autostash", "--no-edit", "feat"],
    ]);
  });

  it("refuses while a merge or rebase is paused", () => {
    const paused = { ...repo(), operation: "merge" as const };
    for (const request of [
      { type: "mergeBranch", branch: "x" },
      { type: "rebaseOnto", branch: "x" },
      { type: "switchAndMerge", target: "y", source: "x" },
    ] as const) {
      expect(planAction(request, paused).ok).toBe(false);
    }
  });
});

describe("worktrees", () => {
  const tree = (path: string, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
    path,
    head: "abc",
    branch: null,
    main: false,
    bare: false,
    locked: null,
    prunable: null,
    current: false,
    changes: 0,
    ahead: 0,
    behind: 0,
    lastActivity: null,
    touched: null,
    uncommitted: null,
    ...extra,
  });
  const withTrees = (...extra: WorktreeInfo[]): RepoState => ({
    ...repo(),
    worktrees: [tree("/repo", { branch: "main", main: true, current: true }), ...extra],
  });
  const agent = tree("/repo.worktrees/agent", { branch: "agent/auth" });
  const reason = (result: PlanResult) => (result.ok ? "" : result.reason);

  it("creates a worktree on a new branch from a start point, or on an existing branch", () => {
    const r = withTrees();
    expect(
      steps(
        planAction({ type: "addWorktree", branch: "agent/x", path: "/w/x", newBranch: true, from: "origin/main" }, r),
      ),
    ).toEqual([["worktree", "add", "-b", "agent/x", "/w/x", "origin/main"]]);
    expect(steps(planAction({ type: "addWorktree", branch: "agent/x", path: "/w/x", newBranch: true }, r))).toEqual([
      ["worktree", "add", "-b", "agent/x", "/w/x", "HEAD"],
    ]);
    expect(steps(planAction({ type: "addWorktree", branch: "old", path: "/w/old", newBranch: false }, r))).toEqual([
      ["worktree", "add", "/w/old", "old"],
    ]);
  });

  it("won't put an existing branch in a second worktree, or reuse a worktree's folder", () => {
    const r = withTrees(agent);
    expect(reason(planAction({ type: "addWorktree", branch: "agent/auth", path: "/w/2", newBranch: false }, r))).toBe(
      "agent/auth is open in another worktree (/repo.worktrees/agent). Open that worktree instead.",
    );
    expect(reason(planAction({ type: "addWorktree", branch: "main", path: "/w/2", newBranch: false }, r))).toBe(
      "main is open in this window.",
    );
    expect(planAction({ type: "addWorktree", branch: "x", path: "/repo.worktrees/agent", newBranch: true }, r).ok).toBe(
      false,
    );
    expect(planAction({ type: "addWorktree", branch: "bad name", path: "/w/3", newBranch: true }, r).ok).toBe(false);
  });

  it("says where a branch is open instead of letting git fail on switch or drag-to-merge", () => {
    const r = withTrees(agent);
    expect(reason(planAction({ type: "switch", branch: "agent/auth" }, r))).toMatch(/open in another worktree/);
    expect(reason(planAction({ type: "switchAndMerge", target: "agent/auth", source: "x" }, r))).toMatch(
      /open in another worktree/,
    );
    expect(planAction({ type: "switch", branch: "other" }, r).ok).toBe(true);
  });

  it("removes a clean worktree, keeping its branch", () => {
    const result = planAction({ type: "removeWorktree", path: agent.path }, withTrees(agent));
    expect(steps(result)).toEqual([["worktree", "remove", "/repo.worktrees/agent"]]);
    expect(result.ok && result.plan.confirm).toBe(
      "Remove the worktree at /repo.worktrees/agent? Its branch agent/auth stays, with all its commits.",
    );
  });

  it("warns that uncommitted files go with it", () => {
    const result = planAction({ type: "removeWorktree", path: agent.path }, withTrees({ ...agent, changes: 7 }));
    expect(steps(result)).toEqual([["worktree", "remove", "--force", "/repo.worktrees/agent"]]);
    expect(result.ok && result.plan.confirm).toMatch(/It has 7 uncommitted files, which will be deleted\./);
  });

  it("won't remove the main checkout, this window's own, a locked one, or one that's gone", () => {
    const locked = tree("/w/locked", { locked: "agent session running" });
    const silent = tree("/w/silent", { locked: "" });
    const gone = tree("/w/gone", { prunable: "gitdir file points to non-existent location" });
    const here = tree("/w/here", { current: true });
    const r = {
      ...withTrees(locked, silent, gone, here),
      worktrees: [tree("/repo", { main: true }), locked, silent, gone, here],
    };
    expect(reason(planAction({ type: "removeWorktree", path: "/repo" }, r))).toMatch(/main checkout/);
    expect(reason(planAction({ type: "removeWorktree", path: "/w/here" }, r))).toMatch(
      /This window has that worktree open/,
    );
    expect(reason(planAction({ type: "removeWorktree", path: "/w/locked" }, r))).toBe(
      "It's locked (agent session running). Unlock it first.",
    );
    expect(reason(planAction({ type: "removeWorktree", path: "/w/silent" }, r))).toBe("It's locked. Unlock it first.");
    expect(steps(planAction({ type: "removeWorktree", path: "/w/gone" }, r))).toEqual([["worktree", "prune"]]);
    expect(reason(planAction({ type: "removeWorktree", path: "/nowhere" }, r))).toMatch(/isn't there any more/);
  });

  it("cleans up gone worktrees only when there are some", () => {
    expect(planAction({ type: "pruneWorktrees" }, withTrees(agent)).ok).toBe(false);
    expect(steps(planAction({ type: "pruneWorktrees" }, withTrees({ ...agent, prunable: "gone" })))).toEqual([
      ["worktree", "prune"],
    ]);
  });

  it("locks with an optional reason, and unlocks", () => {
    const r = withTrees(agent);
    expect(steps(planAction({ type: "lockWorktree", path: agent.path, reason: " agent running " }, r))).toEqual([
      ["worktree", "lock", "--reason", "agent running", "/repo.worktrees/agent"],
    ]);
    expect(steps(planAction({ type: "lockWorktree", path: agent.path }, r))).toEqual([
      ["worktree", "lock", "/repo.worktrees/agent"],
    ]);
    expect(planAction({ type: "unlockWorktree", path: agent.path }, r).ok).toBe(false);
    expect(
      steps(planAction({ type: "unlockWorktree", path: agent.path }, withTrees({ ...agent, locked: "" }))),
    ).toEqual([["worktree", "unlock", "/repo.worktrees/agent"]]);
    expect(planAction({ type: "lockWorktree", path: "/repo" }, r).ok).toBe(false);
  });
});

describe("restoring a checkpoint", () => {
  const checkpoint = {
    ref: "refs/gitkit/checkpoints/main/1",
    hash: "c1",
    time: 1,
    reason: "before claude",
    worktree: "main",
  };
  const withCheckpoint = (extra: Partial<RepoState> = {}): RepoState => ({
    ...repo(),
    checkpoints: [checkpoint],
    ...extra,
  });

  it("puts the files back without touching the staging area or branch", () => {
    const result = planAction({ type: "restoreCheckpoint", hash: "c1" }, withCheckpoint());
    expect(steps(result)).toEqual([["restore", "--source", "c1", "--worktree", "--", "."]]);
    expect(result.ok && result.plan.confirm).toMatch(
      /^Bring this worktree's files back to the checkpoint "before claude"\?/,
    );
  });

  it("refuses an unknown checkpoint, or in the middle of a merge", () => {
    expect(planAction({ type: "restoreCheckpoint", hash: "nope" }, withCheckpoint()).ok).toBe(false);
    expect(planAction({ type: "restoreCheckpoint", hash: "c1" }, withCheckpoint({ operation: "merge" })).ok).toBe(
      false,
    );
  });
});

describe("deleting a branch open in a worktree", () => {
  it("says to remove the worktree instead of letting git fail", () => {
    const r: RepoState = {
      ...repo(),
      worktrees: [
        {
          path: "/repo",
          head: "a",
          branch: "main",
          main: true,
          bare: false,
          locked: null,
          prunable: null,
          current: true,
          changes: 0,
          ahead: 0,
          behind: 0,
          lastActivity: null,
          touched: null,
          uncommitted: null,
        },
        {
          path: "/w/agent",
          head: "b",
          branch: "agent/x",
          main: false,
          bare: false,
          locked: null,
          prunable: null,
          current: false,
          changes: 0,
          ahead: 0,
          behind: 0,
          lastActivity: null,
          touched: null,
          uncommitted: null,
        },
      ],
    };
    expect(planAction({ type: "deleteBranches", names: ["old", "agent/x"] }, r)).toEqual({
      ok: false,
      reason: "agent/x is open in a worktree (/w/agent). Remove that worktree first.",
    });
    expect(planAction({ type: "deleteBranches", names: ["old"] }, r).ok).toBe(true);
  });
});
