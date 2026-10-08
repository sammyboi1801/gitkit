import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBranches, readCommitDetails, readRepo } from "../../src/git/repo";

// Runs the real git commands GitKit uses against a throwaway repo with a bare remote.
let base: string;
let work: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "gitkit-test-"));
  const remote = join(base, "remote.git");
  work = join(base, "work");
  git(base, "init", "--bare", "-b", "main", remote);
  git(base, "clone", remote, work);
  git(work, "checkout", "-b", "main");

  writeFileSync(join(work, "a.txt"), "one\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "first");
  writeFileSync(join(work, "a.txt"), "one\ntwo\n");
  git(work, "commit", "-am", "second");
  git(work, "push", "-u", "origin", "main");

  // One commit only on the remote (behind), one only local (ahead).
  writeFileSync(join(work, "b.txt"), "remote\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "remote only");
  git(work, "push");
  git(work, "reset", "--hard", "HEAD~1");
  writeFileSync(join(work, "c.txt"), "local\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "local only");

  // Uncommitted: one staged edit, one unstaged edit, one untracked file.
  writeFileSync(join(work, "a.txt"), "one\ntwo\nthree\n");
  git(work, "add", "a.txt");
  writeFileSync(join(work, "c.txt"), "local\nmore\nlines\n");
  writeFileSync(join(work, "new file.txt"), "hi\n");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("readRepo against a real repo", () => {
  it("reads status, line stats, ahead/behind and graph markers", async () => {
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

  it("lists branches with tracking info", async () => {
    const [main] = await readBranches(work);
    expect(main).toMatchObject({ name: "main", upstream: "origin/main", ahead: 1, behind: 1, current: true });
  });

  it("reads commit details with per-file stats", async () => {
    const head = git(work, "rev-parse", "HEAD").trim();
    const details = await readCommitDetails(work, head);
    expect(details).toMatchObject({ hash: head, author: "Test", body: "local only" });
    expect(details.files).toEqual([{ path: "c.txt", stats: { added: 1, removed: 0, binary: false } }]);
  });
});

describe("base branch comparison", () => {
  it("counts commits since branching and predicts conflicts without touching files", async () => {
    // origin/main added b.txt; this branch adds a different b.txt, so a merge must conflict.
    git(work, "switch", "-c", "feat");
    writeFileSync(join(work, "b.txt"), "mine\n");
    git(work, "add", "b.txt");
    git(work, "commit", "-m", "mine", "--only", "b.txt");
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
    git(work, "switch", "-c", "fix/local-only");
    const repo = await readRepo(work);
    expect(repo.activity.every((item) => item.ref.startsWith("origin/"))).toBe(true);
  });
});

describe("findWorkspaceRepo", () => {
  it("ignores a parent repo that ignores the opened folder", async () => {
    const { mkdirSync } = await import("node:fs");
    const { findWorkspaceRepo } = await import("../../src/git/repo");
    writeFileSync(join(work, ".gitignore"), "ignored-dir/\n");
    mkdirSync(join(work, "ignored-dir"), { recursive: true });
    mkdirSync(join(work, "tracked-dir"), { recursive: true });
    expect(await findWorkspaceRepo(join(work, "ignored-dir"))).toBeNull();
    expect(await findWorkspaceRepo(join(work, "tracked-dir"))).not.toBeNull();
  });
});

describe("readCleanupCandidates", () => {
  it("finds squash-merged and merged branches but keeps unmerged ones", async () => {
    const { readCleanupCandidates } = await import("../../src/git/repo");
    const cleanup = mkdtempSync(join(tmpdir(), "gitkit-cleanup-"));
    try {
      git(cleanup, "init", "-q", "-b", "main");
      writeFileSync(join(cleanup, "a.txt"), "a\n");
      git(cleanup, "add", ".");
      git(cleanup, "commit", "-qm", "base");

      // squashed: two commits on a branch, landed on main as one squash commit.
      git(cleanup, "switch", "-qc", "squashed");
      writeFileSync(join(cleanup, "s.txt"), "one\n");
      git(cleanup, "add", ".");
      git(cleanup, "commit", "-qm", "s1");
      writeFileSync(join(cleanup, "s.txt"), "one\ntwo\n");
      git(cleanup, "commit", "-qam", "s2");
      git(cleanup, "switch", "-q", "main");
      git(cleanup, "merge", "-q", "--squash", "squashed");
      git(cleanup, "commit", "-qm", "squash merge");

      // merged: a plain fast-forward-able branch already contained in main.
      git(cleanup, "branch", "merged", "HEAD~1");

      // open: real unmerged work.
      git(cleanup, "switch", "-qc", "open");
      writeFileSync(join(cleanup, "o.txt"), "wip\n");
      git(cleanup, "add", ".");
      git(cleanup, "commit", "-qm", "wip");
      git(cleanup, "switch", "-q", "main");

      const names = (await readCleanupCandidates(cleanup, "main", "main")).map((c) => c.branch.name).sort();
      expect(names).toEqual(["merged", "squashed"]);
    } finally {
      rmSync(cleanup, { recursive: true, force: true });
    }
  });
});

describe("undo, end to end", () => {
  it("undoes a commit while keeping uncommitted work, and the undo itself can be undone", async () => {
    const { planAction } = await import("../../src/git/actions");
    const { runGit } = await import("../../src/git/runner");
    const dir = mkdtempSync(join(tmpdir(), "gitkit-undo-"));
    const run = async (request: Parameters<typeof planAction>[0]) => {
      const result = planAction(request, await readRepo(dir));
      if (!result.ok) throw new Error(result.reason);
      for (const args of result.plan.steps) await runGit(args, dir);
    };
    const head = () => git(dir, "rev-parse", "HEAD").trim();
    try {
      git(dir, "init", "-q", "-b", "main");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "first");
      const first = head();
      writeFileSync(join(dir, "b.txt"), "b\n");
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "second");
      const second = head();
      writeFileSync(join(dir, "notes.txt"), "uncommitted\n");

      const before = await readRepo(dir);
      expect(before.history[0]).toMatchObject({ kind: "commit", summary: 'Committed "second"' });

      await run({ type: "undoTo", index: 0 });
      expect(head()).toBe(first);
      expect(git(dir, "status", "--porcelain")).toContain("notes.txt");

      // The reset is itself in the history, so undoing it brings "second" back.
      await run({ type: "undoTo", index: 0 });
      expect(head()).toBe(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
