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

    const subject = (hash: string) => repo.rows.find((r) => r.commit.hash === hash)?.commit.subject;
    expect(repo.unpushed.map(subject)).toEqual(["local only"]);
    expect(repo.incoming.map(subject)).toEqual(["remote only"]);
    expect(repo.rows).toHaveLength(4);
    expect(repo.lanes).toBe(2);

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
