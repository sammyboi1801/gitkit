import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepos, pathKey } from "../../src/git/discover";
import { gitFolderKind, parseWorktreeList, readWorktrees, realPath } from "../../src/git/worktrees";
import { commit, git, initRepo, makeRepo, tempDir } from "../fixtures/repos";

const same = (a: string, b: string) => pathKey(realPath(a)) === pathKey(realPath(b));
const keys = (paths: string[]) => paths.map((p) => pathKey(realPath(p))).sort();

/** A repo in <base>/app with worktrees in <base>/app.worktrees, the layout GitKit creates. */
function repoWithWorktrees() {
  const base = tempDir();
  const app = initRepo(join(base, "app"));
  commit(app, "first", { "a.txt": "one\n" });
  const trees = join(base, "app.worktrees");
  const feature = join(trees, "feature-login");
  git(app, "worktree", "add", "-q", "-b", "feature/login", feature);
  return { base, app, trees, feature };
}

describe("parseWorktreeList", () => {
  it("reads real git output: branches with slashes, detached, locked and deleted worktrees", async () => {
    const { app, trees, feature } = repoWithWorktrees();
    const detached = join(trees, "detached");
    git(app, "worktree", "add", "-q", "--detach", detached);
    const locked = join(trees, "locked");
    git(app, "worktree", "add", "-q", "-b", "agent", locked);
    git(app, "worktree", "lock", "--reason", "agent session running", locked);
    const silent = join(trees, "silent");
    git(app, "worktree", "add", "-q", "-b", "quiet", silent);
    git(app, "worktree", "lock", silent);
    const gone = join(trees, "gone");
    git(app, "worktree", "add", "-q", "-b", "deleted-by-hand", gone);
    rmSync(gone, { recursive: true, force: true });

    const head = git(app, "rev-parse", "HEAD").trim();
    const list = await readWorktrees(app);
    // The main worktree comes first; git orders the rest by its own internal names.
    expect(same(list[0].path, app)).toBe(true);
    const byFolder = Object.fromEntries(
      list.map((w) => [basename(w.path), [w.branch, w.main, w.locked, w.prunable === null ? null : "prunable"]]),
    );
    expect(byFolder).toEqual({
      app: ["main", true, null, null],
      "feature-login": ["feature/login", false, null, null],
      detached: [null, false, null, null],
      locked: ["agent", false, "agent session running", null],
      silent: ["quiet", false, "", null],
      gone: ["deleted-by-hand", false, null, "prunable"],
    });
    expect(list.every((w) => w.head === head && !w.bare)).toBe(true);
    expect(same(list.find((w) => w.branch === "feature/login")!.path, feature)).toBe(true);
    expect(same(list.find((w) => w.branch === null)!.path, detached)).toBe(true);
  });

  it("reads a bare repo's worktrees", async () => {
    const base = tempDir();
    const source = makeRepo();
    git(base, "clone", "-q", "--bare", source, "repo.git");
    const bare = join(base, "repo.git");
    git(bare, "worktree", "add", "-q", join(base, "main"), "main");
    const list = await readWorktrees(bare);
    expect(list.map((w) => [w.bare, w.branch, w.head === null])).toEqual([
      [true, null, true],
      [false, "main", false],
    ]);
  });

  it("handles a path with spaces, and nothing at all", () => {
    expect(parseWorktreeList("worktree /a b/c\0HEAD 1\0branch refs/heads/x\0\0")[0]).toMatchObject({
      branch: "x",
      main: true,
    });
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("gitFolderKind", () => {
  it("tells repos, worktrees and plain folders apart", () => {
    const { base, app, feature } = repoWithWorktrees();
    expect(gitFolderKind(app)).toEqual({ kind: "repo" });
    const tree = gitFolderKind(feature);
    expect(tree.kind).toBe("worktree");
    expect(tree.kind === "worktree" && same(tree.mainRoot!, app)).toBe(true);
    expect(gitFolderKind(base)).toEqual({ kind: "none" });
  });

  it("doesn't mistake a submodule or a repo with a separate git dir for a worktree", () => {
    const library = makeRepo();
    const app = makeRepo();
    git(app, "-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "lib");
    expect(gitFolderKind(join(app, "lib"))).toEqual({ kind: "submodule" });

    const base = tempDir();
    git(base, "init", "-q", "--separate-git-dir", join(base, "elsewhere.git"), join(base, "moved"));
    expect(gitFolderKind(join(base, "moved"))).toEqual({ kind: "repo" });
  });

  it("knows a bare repo's worktree has no main folder to show it under", () => {
    const base = tempDir();
    git(base, "clone", "-q", "--bare", makeRepo(), "repo.git");
    git(join(base, "repo.git"), "worktree", "add", "-q", join(base, "main"), "main");
    expect(gitFolderKind(join(base, "main"))).toEqual({ kind: "worktree", mainRoot: null });
  });
});

describe("discovering repos that have worktrees", () => {
  const noRoot = async () => null;

  it("shows worktrees under their repo, not as repos of their own", async () => {
    const { base, app } = repoWithWorktrees();
    expect(keys(await discoverRepos([base], 2, noRoot))).toEqual(keys([app]));
  });

  it("keeps a worktree opened as the folder itself: that's the repo being worked on", async () => {
    const { feature } = repoWithWorktrees();
    expect(keys(await discoverRepos([feature], 2, async () => feature))).toEqual(keys([feature]));
  });

  it("keeps a worktree whose repo isn't in the workspace, so it doesn't vanish", async () => {
    const { feature } = repoWithWorktrees();
    // Only the worktrees folder is open, not the repo next to it.
    expect(keys(await discoverRepos([join(feature, "..")], 1, noRoot))).toEqual(keys([feature]));
  });

  it("still lists submodules and unrelated repos", async () => {
    const base = tempDir();
    const app = initRepo(join(base, "app"));
    commit(app, "first");
    git(app, "-c", "protocol.file.allow=always", "submodule", "add", "-q", makeRepo(), "lib");
    const other = join(base, "other");
    mkdirSync(other);
    initRepo(other);
    expect(keys(await discoverRepos([base], 2, noRoot))).toEqual(keys([app, join(app, "lib"), other]));
  });
});
