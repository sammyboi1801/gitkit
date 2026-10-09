import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepos, pathKey } from "../../src/git/discover";
import { realPath } from "../../src/git/paths";
import {
  filesToCopy,
  gitFolderKind,
  newWorktreePath,
  parseStatusPaths,
  parseWorktreeList,
  readWorktreeInfo,
  readWorktrees,
  withWorktreesExcluded,
  worktreeFolderName,
} from "../../src/git/worktrees";
import { commit, git, initRepo, makeRepo, tempDir, write } from "../fixtures/repos";

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

describe("readWorktreeInfo", () => {
  it("says what's going on in each worktree: uncommitted work, distance from main, last activity", async () => {
    const { app, trees, feature } = repoWithWorktrees();
    commit(feature, "feat: login form", { "login.txt": "form\n" });
    commit(feature, "test: login", { "login.test.txt": "ok\n" });
    write(feature, "notes.txt", "agent scratch\n"); // New, uncommitted: what agents mostly produce.
    write(feature, "a.txt", "changed\n");
    commit(app, "fix: on main meanwhile", { "b.txt": "b\n" });
    const detached = join(trees, "detached");
    git(app, "worktree", "add", "-q", "--detach", detached, "HEAD~1");
    const gone = join(trees, "gone");
    git(app, "worktree", "add", "-q", "-b", "gone", gone);
    rmSync(gone, { recursive: true, force: true });

    const before = Math.floor(Date.now() / 1000) - 5;
    const info = await readWorktreeInfo(app, "main");
    const byBranch = (b: string | null) => info.find((w) => w.branch === b)!;

    expect(byBranch("main")).toMatchObject({ main: true, current: true, changes: 0, ahead: 0, behind: 0 });
    expect(byBranch("feature/login")).toMatchObject({ current: false, changes: 2, ahead: 2, behind: 1 });
    expect(byBranch("feature/login").lastActivity).toBeGreaterThanOrEqual(before);
    expect(byBranch(null)).toMatchObject({ changes: 0, ahead: 0, behind: 1 });
    // A worktree whose folder was deleted can't be read; it's listed, with no details.
    expect(byBranch("gone")).toMatchObject({ changes: null, ahead: null, lastActivity: null });
    expect(byBranch("gone").prunable).not.toBeNull();
  });

  it("knows which worktree this window has open", async () => {
    const { feature } = repoWithWorktrees();
    const info = await readWorktreeInfo(feature, "main");
    expect(info.map((w) => [w.branch, w.current])).toEqual([
      ["main", false],
      ["feature/login", true],
    ]);
  });

  it("is empty for a repo with just its own checkout", async () => {
    expect(await readWorktreeInfo(makeRepo(), "main")).toEqual([]);
  });

  it("counts a renamed file once", async () => {
    const dir = makeRepo();
    git(dir, "mv", "a.txt", "renamed.txt");
    write(dir, "new.txt", "x\n");
    expect(parseStatusPaths(git(dir, "status", "--porcelain", "-z", "--untracked-files=all")).sort()).toEqual([
      "new.txt",
      "renamed.txt",
    ]);
  });
});

describe("where new worktrees go", () => {
  it.each([
    ["feature/login", "feature-login"],
    ["agent/fix/deep", "agent-fix-deep"],
    ["fix:colon*star", "fix-colon-star"],
    ["release/1.0.", "release-1.0"],
    [".hidden", "hidden"],
    ["con", "con-worktree"],
    ["lpt1", "lpt1-worktree"],
    ["//", "worktree"],
  ])("%s → folder %s", (branch, folder) => {
    expect(worktreeFolderName(branch)).toBe(folder);
  });

  const root = join("/code", "app");
  const none = () => false;

  it("puts them next to the repo by default, or inside it in .worktrees", () => {
    expect(newWorktreePath(root, "feature/login", "sibling", none)).toBe(
      join("/code", "app.worktrees", "feature-login"),
    );
    expect(newWorktreePath(root, "feature/login", "inside", none)).toBe(
      join("/code", "app", ".worktrees", "feature-login"),
    );
  });

  it("numbers names that are taken, including two branches that sanitize alike", () => {
    const taken = new Set([
      join("/code", "app.worktrees", "feature-login"),
      join("/code", "app.worktrees", "feature-login-2"),
    ]);
    // feature/login and feature-login both want "feature-login".
    expect(newWorktreePath(root, "feature-login", "sibling", (p) => taken.has(p))).toBe(
      join("/code", "app.worktrees", "feature-login-3"),
    );
  });

  it("adds the in-repo folder to info/exclude once, keeping what's there", () => {
    expect(withWorktreesExcluded("")).toBe("# Worktrees created by GitKit\n/.worktrees/\n");
    expect(withWorktreesExcluded("*.log")).toBe("*.log\n# Worktrees created by GitKit\n/.worktrees/\n");
    expect(withWorktreesExcluded("*.log\n/.worktrees/\n")).toBeNull();
    expect(withWorktreesExcluded(".worktrees\r\n")).toBeNull();
  });

  it("copies only listed files that exist, stay inside the repo and aren't there yet", () => {
    const from = tempDir();
    const to = tempDir();
    write(from, ".env", "SECRET=1\n");
    write(from, ".vscode/settings.json", "{}");
    write(from, "already.txt", "a");
    write(to, "already.txt", "b");
    const { copy, skipped } = filesToCopy(
      [
        ".env",
        "./.vscode/settings.json",
        "missing.txt",
        "already.txt",
        "../outside",
        "/etc/passwd",
        "C:\\Windows",
        " ",
      ],
      from,
      to,
      existsSync,
    );
    expect(copy.map((c) => c.name)).toEqual([".env", ".vscode/settings.json"]);
    expect(copy[0]).toEqual({ from: join(from, ".env"), to: join(to, ".env"), name: ".env" });
    expect(skipped).toEqual([
      { name: "missing.txt", why: "not found" },
      { name: "already.txt", why: "already there" },
      { name: "../outside", why: "must be a path inside the repo" },
      { name: "/etc/passwd", why: "must be a path inside the repo" },
      { name: "C:\\Windows", why: "must be a path inside the repo" },
    ]);
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
