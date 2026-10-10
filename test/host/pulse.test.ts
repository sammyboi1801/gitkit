import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commit, git, initRepo, makeDivergedClone, makeRepo, tempDir, write } from "../fixtures/repos";
import { harness } from "../mocks/vscode";
import { openPanel } from "./helpers";

const status = (dir: string) => git(dir, "status", "--porcelain");

describe("Pulse panel: states", () => {
  it("asks for a folder when none is open", async () => {
    const panel = await openPanel();
    expect(panel.state()).toEqual({ kind: "no-folder" });
  });

  it("offers to initialize a folder that isn't a repo, and does it", async () => {
    const dir = tempDir();
    const panel = await openPanel(dir);
    expect(panel.state()).toMatchObject({ kind: "no-repo" });
    await panel.send({ type: "initRepo" });
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(panel.state().kind).toBe("repo");
  });

  it("shows the repo with branch, files and graph", async () => {
    const { work } = makeDivergedClone();
    const panel = await openPanel(work);
    const repo = panel.repo();
    expect(repo.status).toMatchObject({ branch: "main", ahead: 1, behind: 1 });
    expect(repo.status.files.map((f) => f.path).sort()).toEqual(["a.txt", "c.txt", "new file.txt"]);
    expect(repo.graph.commits.length).toBe(4);
  });
});

describe("Pulse panel: changes and commits", () => {
  it("stages and unstages files", async () => {
    const dir = makeRepo();
    write(dir, "b.txt", "new\n");
    const panel = await openPanel(dir);

    await panel.send({ type: "action", request: { type: "stage", paths: ["b.txt"] } });
    expect(status(dir)).toContain("A  b.txt");
    expect(panel.repo().status.files[0]).toMatchObject({ path: "b.txt", index: "A" });

    await panel.send({ type: "action", request: { type: "unstage", paths: ["b.txt"] } });
    expect(status(dir)).toContain("?? b.txt");
  });

  it("commits everything when nothing is staged", async () => {
    const dir = makeRepo();
    write(dir, "b.txt", "new\n");
    const panel = await openPanel(dir);
    await panel.send({ type: "action", request: { type: "commit", message: "add b" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("add b");
    expect(status(dir)).toBe("");
  });

  it("discards into a stash only after confirmation", async () => {
    const dir = makeRepo();
    write(dir, "a.txt", "changed\n");
    const panel = await openPanel(dir);

    harness.answers.push(undefined); // Dismiss the confirmation.
    await panel.send({ type: "action", request: { type: "discard", paths: ["a.txt"] } });
    expect(status(dir)).toContain("a.txt");

    harness.answers.push("Discard");
    await panel.send({ type: "action", request: { type: "discard", paths: ["a.txt"] } });
    expect(status(dir)).toBe("");
    expect(panel.repo().stashes[0]).toMatchObject({ byGitKit: true });
    expect(harness.shown.find((s) => s.kind === "warning")?.message).toMatch(/get them back/);
  });

  it("reports why an action can't run instead of running it", async () => {
    const dir = makeRepo();
    const panel = await openPanel(dir);
    await panel.send({ type: "action", request: { type: "push" } });
    expect(panel.posted("error").at(-1)?.error.message).toMatch(/No remote configured/);
  });

  it("shows git's own error and the command when git fails", async () => {
    const dir = makeRepo();
    const panel = await openPanel(dir);
    await panel.send({ type: "action", request: { type: "switch", branch: "does-not-exist" } });
    const error = panel.posted("error").at(-1)!.error;
    expect(error.command).toBe("git switch does-not-exist");
    expect(error.message).toBeTruthy();
  });
});

describe("Pulse panel: commit guard", () => {
  it("leaves a .env file out of the commit and ignores it", async () => {
    const dir = makeRepo();
    write(dir, ".env", "SECRET=1\n");
    write(dir, "app.ts", "export {};\n");
    const panel = await openPanel(dir);

    harness.answers.push("Leave Those Out");
    await panel.send({ type: "action", request: { type: "commit", message: "add app" } });
    // The new ignore rule is committed along with the real change; the .env file is not.
    const committed = git(dir, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();
    expect(committed).toEqual([".gitignore", "app.ts"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("/.env");
    expect(status(dir)).toBe("");
  });

  it("can be told to commit anyway, and can be turned off", async () => {
    const dir = makeRepo();
    write(dir, "key.pem", "-----BEGIN RSA PRIVATE KEY-----\n");
    const panel = await openPanel(dir);
    harness.answers.push("Commit Anyway");
    await panel.send({ type: "action", request: { type: "commit", message: "add key" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("add key");

    harness.config["gitkit.commitGuard.enabled"] = false;
    write(dir, ".env", "X=1\n");
    const shownBefore = harness.shown.length;
    await panel.send({ type: "action", request: { type: "commit", message: "add env" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("add env");
    expect(harness.shown.length).toBe(shownBefore);
  });

  it("cancels the commit when the warning is dismissed", async () => {
    const dir = makeRepo();
    write(dir, "config.ts", "const key = 'AKIAABCDEFGHIJKLMNOP';\n");
    const panel = await openPanel(dir);
    harness.answers.push(undefined);
    await panel.send({ type: "action", request: { type: "commit", message: "oops" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("first");
    expect(harness.shown.at(-1)?.detail).toMatch(/config\.ts:1 looks like an AWS access key/);
  });

  it("checks changes added to the last commit too", async () => {
    const dir = makeRepo();
    write(dir, "config.ts", "const key = 'AKIAABCDEFGHIJKLMNOP';\n");
    const panel = await openPanel(dir);
    harness.answers.push(undefined);
    await panel.send({ type: "action", request: { type: "amendAdd" } });
    expect(git(dir, "show", "--name-only", "--format=", "HEAD").trim()).toBe("a.txt");
    expect(harness.shown.at(-1)?.detail).toMatch(/config\.ts:1 looks like an AWS access key/);
  });

  it("scans the start of a big new file rather than skipping it", async () => {
    const dir = makeRepo();
    write(dir, "export.csv", "key,AKIAABCDEFGHIJKLMNOP\n" + "x".repeat(2 * 1024 * 1024));
    const panel = await openPanel(dir);
    harness.answers.push(undefined);
    await panel.send({ type: "action", request: { type: "commit", message: "export" } });
    expect(harness.shown.at(-1)?.detail).toMatch(/export\.csv:1 looks like an AWS access key/);
  });

  it("leaves a file out of the very first commit too", async () => {
    const dir = initRepo(tempDir());
    write(dir, ".env", "SECRET=1\n");
    write(dir, "app.ts", "export {};\n");
    git(dir, "add", "-A");
    const panel = await openPanel(dir);
    harness.answers.push("Leave Those Out");
    await panel.send({ type: "action", request: { type: "commit", message: "start" } });
    expect(panel.posted("error")).toEqual([]);
    // Only what was staged is committed; the new ignore rule waits to be staged like any change.
    expect(git(dir, "show", "--name-only", "--format=", "HEAD").trim()).toBe("app.ts");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("/.env");
    expect(status(dir)).toContain("?? .gitignore");
  });

  it("sizes a staged file by what's staged, not by the copy on disk", async () => {
    const dir = makeRepo();
    write(dir, "model.bin", "0".repeat(2 * 1024 * 1024));
    git(dir, "add", "model.bin");
    write(dir, "model.bin", "small now\n");
    harness.config["gitkit.commitGuard.maxFileSizeMB"] = 1;
    const panel = await openPanel(dir);
    harness.answers.push(undefined);
    await panel.send({ type: "action", request: { type: "commit", message: "model" } });
    expect(harness.shown.at(-1)?.detail).toMatch(/model\.bin is 2\.0 MB/);
  });

  it("sets the expected email for this repo when identities say so", async () => {
    const dir = makeRepo();
    harness.config["gitkit.identities"] = [{ folder: dir, email: "me@school.edu" }];
    write(dir, "b.txt", "b\n");
    const panel = await openPanel(dir);
    harness.answers.push("Use me@school.edu Here");
    await panel.send({ type: "action", request: { type: "commit", message: "as school" } });
    // --local: the fixture helper passes -c user.email, which a plain read would return instead.
    expect(git(dir, "config", "--local", "user.email").trim()).toBe("me@school.edu");
    expect(git(dir, "log", "-1", "--format=%ae").trim()).toBe("me@school.edu");
  });
});

describe("Pulse panel: branches", () => {
  it("creates a branch from the picker", async () => {
    const dir = makeRepo();
    const panel = await openPanel(dir);
    harness.answers.push((items: { create?: boolean }[]) => items.find((i) => i.create), "feat/new");
    await panel.send({ type: "pickBranch" });
    expect(git(dir, "branch", "--show-current").trim()).toBe("feat/new");
  });

  it("switches to an existing branch from the picker", async () => {
    const dir = makeRepo();
    git(dir, "branch", "other");
    const panel = await openPanel(dir);
    harness.answers.push((items: { branch?: string }[]) => items.find((i) => i.branch === "other"));
    await panel.send({ type: "pickBranch" });
    expect(git(dir, "branch", "--show-current").trim()).toBe("other");
  });

  it("branches from a commit and copies hashes", async () => {
    const dir = makeRepo();
    const first = git(dir, "rev-parse", "HEAD").trim();
    commit(dir, "second");
    const panel = await openPanel(dir);

    harness.answers.push("from-first");
    await panel.send({ type: "branchFrom", hash: first });
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(first);
    expect(git(dir, "branch", "--show-current").trim()).toBe("from-first");

    await panel.send({ type: "copyHash", hash: first });
    expect(harness.clipboard).toBe(first);
  });

  it("sends commit details on request", async () => {
    const dir = makeRepo();
    const hash = commit(dir, "second", { "b.txt": "1\n2\n" });
    const panel = await openPanel(dir);
    await panel.send({ type: "commitDetails", hash });
    expect(panel.posted("commitDetails").at(-1)?.details).toMatchObject({
      hash,
      body: "second",
      files: [{ path: "b.txt", stats: { added: 2, removed: 0, binary: false } }],
    });
  });

  it("reports a failure instead of dropping it, e.g. when the repo vanished", async () => {
    const dir = makeRepo();
    write(dir, "b.txt", "b\n");
    const panel = await openPanel(dir);
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    await panel.send({ type: "action", request: { type: "stage", paths: ["b.txt"] } });
    expect(panel.posted("error").at(-1)?.error.message).toMatch(/not a git repository/i);
  });

  it("never lets a message from the webview become a git option or reach outside the repo", async () => {
    const base = tempDir();
    const dir = initRepo(join(base, "repo"));
    commit(dir, "first", { "a.txt": "one\n" });
    write(base, "outside.txt", "not yours\n");
    const panel = await openPanel(dir);

    // git show --output=<file> would write a file anywhere.
    const target = join(dir, "written-by-git-show.txt");
    await panel.send({ type: "commitDetails", hash: `--output=${target}` });
    expect(existsSync(target)).toBe(false);
    expect(panel.posted("error").at(-1)?.error.message).toMatch(/isn't a commit/);

    for (const message of [
      { type: "openFile", path: "../outside.txt" },
      { type: "conflictDetails", path: "../x" },
      { type: "resolveConflict", path: "../x", block: "all", choice: "ours" },
      { type: "openMergeEditor", path: "../x" },
    ] as const) {
      const errors = panel.posted("error").length;
      await panel.send(message);
      expect(panel.posted("error").length, message.type).toBe(errors + 1);
      expect(panel.posted("error").at(-1)?.error.message).toMatch(/isn't in this repository/);
    }
    expect(harness.opened).toEqual([]);
    expect(harness.executed.filter((c) => c.command === "_open.mergeEditor")).toEqual([]);
  });
});

describe("Pulse panel: remote", () => {
  it("syncs a diverged branch by rebasing then pushing", async () => {
    const { work, remote } = makeDivergedClone();
    git(work, "stash", "-u", "-q"); // A clean tree keeps this test about syncing.
    const panel = await openPanel(work);
    await panel.send({ type: "action", request: { type: "sync" } });
    expect(panel.repo().status).toMatchObject({ ahead: 0, behind: 0 });
    expect(git(remote, "log", "-1", "--format=%s", "main").trim()).toBe("local only");
  });

  it("only opens web links from the webview", async () => {
    const panel = await openPanel(makeRepo());
    await panel.send({ type: "openUrl", url: "file:///etc/passwd" });
    await panel.send({ type: "openUrl", url: "https://github.com/o/r/actions" });
    expect(harness.opened).toEqual(["https://github.com/o/r/actions"]);
  });
});

describe("Pulse panel: several repos", () => {
  it("lists every repo in the folder and switches between them", async () => {
    const parent = tempDir();
    for (const name of ["api", "web"]) {
      const dir = join(parent, name);
      mkdirSync(dir);
      initRepo(dir);
      commit(dir, `${name} first`);
    }
    const panel = await openPanel(parent);
    const state = panel.state();
    expect(state.kind === "repo" && state.repos.map((r) => r.label).sort()).toEqual(["api", "web"]);

    const other = state.kind === "repo" ? state.repos.find((r) => r.root !== state.repo.root)! : null;
    await panel.send({ type: "selectRepo", root: other!.root });
    expect(panel.repo().root).toBe(other!.root);
  });
});

describe("Pulse panel: regressions", () => {
  it("plans from the repo as it is now, not the last refresh", async () => {
    const dir = makeRepo();
    const panel = await openPanel(dir);
    // Edited after the panel last looked, and no watcher event has arrived yet.
    write(dir, "late.txt", "x\n");
    await panel.send({ type: "action", request: { type: "commit", message: "late edit" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("late edit");
  });

  it("leaves a tracked sensitive file out with an exclude, without ignoring it", async () => {
    const dir = makeRepo();
    commit(dir, "add npmrc", { ".npmrc": "registry=x\n" });
    write(dir, ".npmrc", "//registry/:_authToken=abc\n");
    write(dir, "app.ts", "export {};\n");
    const panel = await openPanel(dir);

    harness.answers.push("Leave Those Out");
    await panel.send({ type: "action", request: { type: "commit", message: "app only" } });
    expect(git(dir, "show", "--name-only", "--format=", "HEAD").trim()).toBe("app.ts");
    expect(status(dir)).toContain(" M .npmrc");
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });
});

describe("Pulse panel: identity rules and path spellings", () => {
  it("matches a folder rule written with a different path to the same folder", async () => {
    // Windows reports some folders by a short 8.3 name in one place and the long name in another;
    // a junction (an alias for a folder) reproduces the same mismatch on any machine.
    const dir = makeRepo();
    const alias = join(tempDir(), "alias");
    symlinkSync(dir, alias, "junction");
    harness.config["gitkit.identities"] = [{ folder: alias, email: "me@school.edu" }];
    write(dir, "b.txt", "b\n");
    const panel = await openPanel(dir);

    harness.answers.push("Use me@school.edu Here");
    await panel.send({ type: "action", request: { type: "commit", message: "as school" } });
    expect(git(dir, "log", "-1", "--format=%ae").trim()).toBe("me@school.edu");
  });
});
