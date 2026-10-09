import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planAction, type ActionRequest } from "../../src/git/actions";
import {
  findWorkspaceRepo,
  readBranches,
  readCleanupCandidates,
  readCommitDetails,
  readRepo,
} from "../../src/git/repo";
import { runGit } from "../../src/git/runner";
import { commit, git, makeDivergedClone, makeRepo, tempDir, write } from "../fixtures/repos";

// Runs the real git commands GitKit uses against throwaway repos. Each test builds its own.

describe("readRepo", () => {
  it("reads status, line stats, ahead/behind and graph markers", async () => {
    const { work } = makeDivergedClone();
    const repo = await readRepo(work);
    const { status } = repo;

    expect(status).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1, behind: 1 });
    expect(repo.remotes).toEqual(["origin"]);

    const byPath = Object.fromEntries(status.files.map((f) => [f.path, f]));
    expect(byPath["a.txt"].indexStats).toEqual({ added: 1, removed: 0, binary: false });
    expect(byPath["c.txt"].worktreeStats).toEqual({ added: 2, removed: 0, binary: false });
    expect(byPath["new file.txt"].untracked).toBe(true);

    const subject = (hash: string) => repo.graph.commits.find((c) => c.hash === hash)?.subject;
    expect(repo.unpushed.map(subject)).toEqual(["local only"]);
    expect(repo.incoming.map(subject)).toEqual(["remote only"]);
    expect(repo.graph.commits).toHaveLength(4);
    // One lane: the remote-only commit sits on main, in line with the local ones.
    expect(repo.graph.lanes.map((l) => l.name)).toEqual(["main"]);

    // On main itself, main is "current" rather than something to update from.
    expect(repo.base).toMatchObject({ ref: "origin/main", isCurrent: true });
    expect(repo.operation).toBeNull();
    expect(repo.activity[0]).toMatchObject({ ref: "origin/main", kind: "push", commits: 1, authors: ["Test"] });
  });

  it("counts main's new commits on the remote as not pulled yet, even from another branch", async () => {
    const { work, remote } = makeDivergedClone();
    git(work, "stash", "-q", "--include-untracked");
    git(work, "switch", "-q", "--no-track", "-c", "feat", "origin/main");
    const other = join(work, "..", "other");
    git(join(work, ".."), "clone", "-q", remote, other);
    commit(other, "teammate on main");
    git(other, "push", "-q", "origin", "HEAD:main");
    git(work, "fetch", "-q");

    const repo = await readRepo(work);
    const subject = (hash: string) => repo.graph.commits.find((c) => c.hash === hash)?.subject;
    expect(repo.status.upstream).toBeNull();
    expect(repo.incoming.map(subject)).toEqual(["teammate on main"]);
  });

  it("handles a repo with no commits yet", async () => {
    const empty = tempDir();
    git(empty, "init", "-q", "-b", "main");
    write(empty, "new.txt", "x\n");

    const repo = await readRepo(empty);
    expect(repo.status).toMatchObject({ branch: "main", oid: null });
    expect(repo.graph.commits).toEqual([]);
    expect(repo.history).toEqual([]);
    expect(repo.base).toBeNull();
  });

  it("detects a merge stopped on a conflict", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "other");
    commit(dir, "theirs", { "a.txt": "theirs\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "ours", { "a.txt": "ours\n" });
    expect(() => git(dir, "merge", "other")).toThrow();

    const repo = await readRepo(dir);
    expect(repo.operation).toBe("merge");
    expect(repo.status.files).toEqual([expect.objectContaining({ path: "a.txt", conflicted: true })]);
  });
});

describe("readBranches and readCommitDetails", () => {
  it("lists branches with tracking info", async () => {
    const { work } = makeDivergedClone();
    const [main] = await readBranches(work);
    expect(main).toMatchObject({ name: "main", upstream: "origin/main", ahead: 1, behind: 1, current: true });
  });

  it("reads commit details with per-file stats", async () => {
    const { work } = makeDivergedClone();
    const head = git(work, "rev-parse", "HEAD").trim();
    const details = await readCommitDetails(work, head);
    expect(details).toMatchObject({ hash: head, author: "Test", body: "local only" });
    expect(details.files).toEqual([{ path: "c.txt", stats: { added: 1, removed: 0, binary: false } }]);
  });
});

describe("base branch comparison", () => {
  it("counts commits since branching and predicts conflicts without touching files", async () => {
    const { work } = makeDivergedClone();
    // origin/main added b.txt; this branch adds a different b.txt, so a merge must conflict.
    git(work, "switch", "-q", "-c", "feat");
    write(work, "b.txt", "mine\n");
    git(work, "add", "b.txt");
    git(work, "commit", "-q", "-m", "mine", "--only", "b.txt");
    const statusBefore = git(work, "status", "--porcelain");

    const repo = await readRepo(work);
    expect(repo.base).toMatchObject({
      ref: "origin/main",
      ahead: 2,
      behind: 1,
      isCurrent: false,
      conflicts: ["b.txt"],
    });
    expect(git(work, "status", "--porcelain")).toBe(statusBefore);
  });
});

describe("activity feed", () => {
  it("only reports remote branches, never local ones with a slash in the name", async () => {
    const { work } = makeDivergedClone();
    git(work, "switch", "-q", "-c", "fix/local-only");
    const repo = await readRepo(work);
    expect(repo.activity.length).toBeGreaterThan(0);
    expect(repo.activity.every((item) => item.ref.startsWith("origin/"))).toBe(true);
  });
});

describe("findWorkspaceRepo", () => {
  it("ignores a parent repo that ignores the opened folder", async () => {
    const dir = makeRepo();
    write(dir, ".gitignore", "ignored-dir/\n");
    mkdirSync(join(dir, "ignored-dir"));
    mkdirSync(join(dir, "tracked-dir"));
    expect(await findWorkspaceRepo(join(dir, "ignored-dir"))).toBeNull();
    expect(await findWorkspaceRepo(join(dir, "tracked-dir"))).not.toBeNull();
  });
});

describe("readCleanupCandidates", () => {
  it("finds squash-merged and merged branches but keeps unmerged ones", async () => {
    const dir = makeRepo();
    // squashed: two commits on a branch, landed on main as one squash commit.
    git(dir, "switch", "-q", "-c", "squashed");
    commit(dir, "s1", { "s.txt": "one\n" });
    commit(dir, "s2", { "s.txt": "one\ntwo\n" });
    git(dir, "switch", "-q", "main");
    git(dir, "merge", "-q", "--squash", "squashed");
    git(dir, "commit", "-q", "-m", "squash merge");
    // merged: a branch whose commit main already contains.
    git(dir, "branch", "merged", "HEAD~1");
    // open: real unmerged work.
    git(dir, "switch", "-q", "-c", "open");
    commit(dir, "wip", { "o.txt": "wip\n" });
    git(dir, "switch", "-q", "main");

    const names = (await readCleanupCandidates(dir, "main", "main")).map((c) => c.branch.name).sort();
    expect(names).toEqual(["merged", "squashed"]);
  });
});

describe("undo, end to end", () => {
  const run = async (dir: string, request: ActionRequest) => {
    const result = planAction(request, await readRepo(dir));
    if (!result.ok) throw new Error(result.reason);
    for (const args of result.plan.steps) await runGit(args, dir);
  };
  const head = (dir: string) => git(dir, "rev-parse", "HEAD").trim();

  it("undoes a commit while keeping uncommitted work, and the undo itself can be undone", async () => {
    const dir = makeRepo();
    const first = head(dir);
    const second = commit(dir, "second", { "b.txt": "b\n" });
    write(dir, "notes.txt", "uncommitted\n");

    const before = await readRepo(dir);
    expect(before.history[0]).toMatchObject({ kind: "commit", summary: 'Committed "second"' });

    await run(dir, { type: "undoTo", index: 0 });
    expect(head(dir)).toBe(first);
    expect(git(dir, "status", "--porcelain")).toContain("notes.txt");

    // The reset is itself in the history, so undoing it brings "second" back.
    await run(dir, { type: "undoTo", index: 0 });
    expect(head(dir)).toBe(second);
  });

  it("undoes the last commit but keeps its changes staged", async () => {
    const dir = makeRepo();
    const first = head(dir);
    commit(dir, "oops", { "b.txt": "b\n" });

    await run(dir, { type: "undoLastCommit" });
    expect(head(dir)).toBe(first);
    expect(git(dir, "status", "--porcelain")).toContain("A  b.txt");
  });

  it("discards into a stash that can be restored", async () => {
    const dir = makeRepo();
    write(dir, "a.txt", "changed\n");

    await run(dir, { type: "discard", paths: ["a.txt"] });
    expect(git(dir, "status", "--porcelain")).toBe("");

    const repo = await readRepo(dir);
    expect(repo.stashes[0]).toMatchObject({ byGitKit: true, message: "GitKit discard: a.txt" });
    await run(dir, { type: "stashPop", ref: repo.stashes[0].ref });
    expect(git(dir, "status", "--porcelain")).toContain("a.txt");
  });
});

describe("runGit", () => {
  it("prints non-ASCII paths as-is, whatever the repo's own config says", async () => {
    const dir = makeRepo();
    git(dir, "config", "core.quotePath", "true");
    commit(dir, "accent", { "café.txt": "x\n" });
    const { stdout } = await runGit(["ls-files"], dir);
    expect(stdout.split("\n")).toContain("café.txt");
  });

  it("reports failures with git's English message and the command that failed", async () => {
    const dir = makeRepo();
    await expect(runGit(["switch", "no-such-branch"], dir)).rejects.toMatchObject({
      command: "git switch no-such-branch",
      stderr: expect.stringMatching(/invalid reference|did not match/i),
    });
  });
});
