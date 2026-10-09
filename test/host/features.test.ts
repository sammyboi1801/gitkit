import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activate, workflowFile } from "../../src/extension";
import { readCi, readPullRequest, rerunFailedJobs } from "../../src/github/client";
import { readRepo } from "../../src/git/repo";
import type { HostToStudio } from "../../src/shared/messages";
import type { WorkflowModel } from "../../src/workflow/model";
import { DEFAULT_AGENTS, explainFailure } from "../../src/features/pulse/PulseViewProvider";
import { listCheckpoints, readCheckpointState } from "../../src/git/checkpoints";
import { formatCommand } from "../../src/git/format";
import { realPath, samePath } from "../../src/git/paths";
import { commit, git, initRepo, makeDivergedClone, makeRepo, tempDir, write } from "../fixtures/repos";
import { harness, Uri } from "../mocks/vscode";
import { memento, openPanel } from "./helpers";

/** Picks the quick-pick item whose label contains `text`. */
const pick = (text: string) => (items: { label: string }[]) => {
  const item = items.find((i) => i.label.includes(text));
  if (!item) throw new Error(`No item containing "${text}" in: ${items.map((i) => i.label).join(" | ")}`);
  return item;
};
const subjects = (dir: string) => git(dir, "log", "--format=%s").trim().split("\n");

function activateExtension() {
  const context = {
    extensionUri: Uri.file("/extension"),
    workspaceState: memento(),
    subscriptions: [] as { dispose(): void }[],
  };
  activate(context as never);
  return context;
}

const contexts: { subscriptions: { dispose(): void }[] }[] = [];
afterEach(() => {
  contexts.splice(0).forEach((c) => c.subscriptions.forEach((d) => d.dispose()));
  vi.unstubAllGlobals();
});

describe("activation", () => {
  it("registers the panel, every command and the merge-editor content provider", () => {
    contexts.push(activateExtension());
    expect([...harness.views.keys()]).toEqual(["gitkit.pulse"]);
    expect([...harness.commands.keys()].sort()).toEqual([
      "gitkit.checkpoint",
      "gitkit.cleanupBranches",
      "gitkit.newWorktree",
      "gitkit.oops",
      "gitkit.openBranchMap",
      "gitkit.openWorkflowStudio",
      "gitkit.refresh",
    ]);
    expect(harness.contentProviders.has("gitkit-stage")).toBe(true);
  });
});

describe("Oops", () => {
  it("undoes the last commit and keeps its changes staged", async () => {
    const dir = makeRepo();
    commit(dir, "oops", { "b.txt": "b\n" });
    const panel = await openPanel(dir);
    harness.answers.push(pick("Undo my last commit"), "Undo commit");
    await panel.send({ type: "oops" });
    expect(subjects(dir)).toEqual(["first"]);
    expect(git(dir, "status", "--porcelain")).toContain("A  b.txt");
  });

  it("rewords the last commit", async () => {
    const dir = makeRepo();
    commit(dir, "tpyo");
    const panel = await openPanel(dir);
    harness.answers.push(pick("Change the last commit's message"), "typo fixed");
    await panel.send({ type: "oops" });
    expect(subjects(dir)[0]).toBe("typo fixed");
  });

  it("moves commits made on the wrong branch to a new one", async () => {
    const dir = makeRepo();
    commit(dir, "meant for a feature", { "f.txt": "f\n" });
    const panel = await openPanel(dir);
    harness.answers.push(
      pick("I committed to the wrong branch"),
      pick("meant for a feature"),
      "feat/right",
      "Move commits",
    );
    await panel.send({ type: "oops" });
    expect(git(dir, "branch", "--show-current").trim()).toBe("feat/right");
    expect(subjects(dir)[0]).toBe("meant for a feature");
    expect(git(dir, "log", "--format=%s", "main").trim()).toBe("first");
  });

  it("recovers a deleted branch from the history", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "lost-work");
    const tip = commit(dir, "precious");
    git(dir, "switch", "-q", "main");
    git(dir, "branch", "-q", "-D", "lost-work");
    const panel = await openPanel(dir);
    harness.answers.push(pick("Recover a deleted branch"), pick("lost-work"));
    await panel.send({ type: "oops" });
    expect(git(dir, "rev-parse", "lost-work").trim()).toBe(tip);
  });

  it("gets back discarded changes", async () => {
    const dir = makeRepo();
    write(dir, "a.txt", "work in progress\n");
    const panel = await openPanel(dir);
    harness.answers.push("Discard");
    await panel.send({ type: "action", request: { type: "discard", paths: ["a.txt"] } });
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\n");

    harness.answers.push(pick("Get back changes"), pick("GitKit discard"));
    await panel.send({ type: "oops" });
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("work in progress\n");
  });

  it("stops tracking a file and ignores it", async () => {
    const dir = makeRepo();
    commit(dir, "add build output", { "dist/bundle.js": "x\n" });
    const panel = await openPanel(dir);
    harness.answers.push(pick("Stop tracking a file"), "dist/bundle.js", pick("Yes"), "Stop tracking");
    await panel.send({ type: "oops" });
    expect(git(dir, "ls-files").split("\n")).not.toContain("dist/bundle.js");
    expect(existsSync(join(dir, "dist", "bundle.js"))).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("/dist/bundle.js");
  });

  it("cleans up merged branches", async () => {
    const dir = makeRepo();
    git(dir, "branch", "already-merged");
    commit(dir, "more on main");
    const panel = await openPanel(dir);
    harness.answers.push(pick("Clean up branches"), (items: { label: string }[]) => items, "Delete branches");
    await panel.send({ type: "oops" });
    expect(git(dir, "branch", "--format=%(refname:short)").trim()).toBe("main");
  });

  it("goes back in time, and can go forward again", async () => {
    const dir = makeRepo();
    commit(dir, "second");
    const panel = await openPanel(dir);
    harness.answers.push(pick("Go back in time"), pick('Committed "second"'), "Undo");
    await panel.send({ type: "oops" });
    expect(subjects(dir)).toEqual(["first"]);

    harness.answers.push(pick("Go back in time"), pick("Moved branch"), "Undo");
    await panel.send({ type: "oops" });
    expect(subjects(dir)).toEqual(["second", "first"]);
  });
});

describe("refreshing", () => {
  it("waits for a fresh read when one is already running, so actions see their own result", async () => {
    const dir = makeRepo();
    const panel = await openPanel(dir);
    const provider = panel.provider as unknown as { readState: () => Promise<unknown> };
    const read = provider.readState.bind(panel.provider);
    let started = 0;
    let finished = 0;
    provider.readState = async () => {
      started++;
      const state = await read();
      finished++;
      return state;
    };

    const running = panel.provider.refresh(); // e.g. the file watcher, before an action finished
    write(dir, "new.txt", "made by the action\n");
    await panel.provider.refresh();
    // The second call must not reuse the read that started before it.
    expect(started).toBe(2);
    expect(finished).toBe(2);
    expect(panel.repo().status.files.map((f) => f.path)).toContain("new.txt");
    await running;

    // Callers arriving while one is queued share it rather than piling up reads.
    const a = panel.provider.refresh();
    const b = panel.provider.refresh();
    const c = panel.provider.refresh();
    await Promise.all([a, b, c]);
    expect(started).toBe(4);
  });
});

describe("conflicts", () => {
  function conflicted() {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "feat/label");
    commit(dir, "theirs", { "a.txt": "incoming\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "ours", { "a.txt": "mine\n" });
    expect(() => git(dir, "merge", "feat/label")).toThrow();
    return dir;
  }

  it("shows the clash, resolves it, marks it resolved and continues the merge", async () => {
    const dir = conflicted();
    const panel = await openPanel(dir);
    expect(panel.repo().operation).toBe("merge");

    await panel.send({ type: "conflictDetails", path: "a.txt" });
    expect(panel.posted("conflictDetails").at(-1)?.blocks).toEqual([
      expect.objectContaining({ ours: ["mine"], theirs: ["incoming"], theirsLabel: "feat/label" }),
    ]);

    await panel.send({ type: "resolveConflict", path: "a.txt", block: 0, choice: "theirs" });
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("incoming\n");
    expect(panel.posted("conflictDetails").at(-1)?.blocks).toEqual([]);

    await panel.send({ type: "action", request: { type: "stage", paths: ["a.txt"] } });
    await panel.send({ type: "action", request: { type: "continueOperation" } });
    expect(panel.repo().operation).toBeNull();
    expect(git(dir, "log", "-1", "--format=%P").trim().split(" ")).toHaveLength(2);
  });

  it("pauses on a conflict without calling it an error, but reports real failures", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "feat/label");
    commit(dir, "theirs", { "a.txt": "incoming\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "ours", { "a.txt": "mine\n" });
    const panel = await openPanel(dir);

    harness.answers.push("Merge into main");
    await panel.send({ type: "action", request: { type: "mergeBranch", branch: "feat/label" } });
    expect(panel.repo().operation).toBe("merge");
    expect(panel.posted("error")).toEqual([]);

    // Not a conflict: git refuses outright, and that is an error worth showing.
    harness.answers.push("Abort");
    await panel.send({ type: "action", request: { type: "abortOperation" } });
    await panel.send({ type: "action", request: { type: "switch", branch: "no-such-branch" } });
    expect(panel.posted("error").at(-1)?.error.command).toBe("git switch no-such-branch");
  });

  it("aborts back to exactly how things were", async () => {
    const dir = conflicted();
    const panel = await openPanel(dir);
    harness.answers.push("Abort");
    await panel.send({ type: "action", request: { type: "abortOperation" } });
    expect(panel.repo().operation).toBeNull();
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("mine\n");
  });

  it("opens the merge editor with git's three versions of the file", async () => {
    contexts.push(activateExtension());
    const dir = conflicted();
    const panel = await openPanel(dir);
    await panel.send({ type: "openMergeEditor", path: "a.txt" });

    const call = harness.executed.find((c) => c.command === "_open.mergeEditor");
    const args = call?.args[0] as {
      base: Uri;
      input1: { uri: Uri; title: string };
      input2: { uri: Uri; title: string };
    };
    expect(args.input1.title).toBe("Yours");
    expect(args.input2.title).toBe("Incoming");
    const provider = harness.contentProviders.get("gitkit-stage")!;
    expect(await provider.provideTextDocumentContent(args.base)).toBe("one\n");
    expect(await provider.provideTextDocumentContent(args.input1.uri)).toBe("mine\n");
    expect(await provider.provideTextDocumentContent(args.input2.uri)).toBe("incoming\n");
  });
});

describe("Branch Map", () => {
  it("opens as a tab and receives the same live state as the sidebar", async () => {
    contexts.push(activateExtension());
    const dir = makeRepo();
    harness.folders = [dir];
    const sidebar = harness.resolveView(harness.views.get("gitkit.pulse")!);
    await sidebar.send({ type: "ready" });

    await harness.commands.get("gitkit.openBranchMap")!();
    const map = harness.panels.find((p) => p.viewType === "gitkit.branchMap")!;
    expect(map.webview.html).toContain("map.js");

    await map.webview.send({ type: "ready" });
    const state = map.webview.posted.filter((m) => (m as { type: string }).type === "state").at(-1) as {
      state: { kind: string };
    };
    expect(state.state.kind).toBe("repo");
    expect(map.webview.posted).toContainEqual({ type: "config", mainBranchColor: "blue" });
  });

  it("shows the colour icon on its tab and Workflow Studio's, and packages it", async () => {
    contexts.push(activateExtension());
    harness.folders = [makeRepo()];
    await harness.resolveView(harness.views.get("gitkit.pulse")!).send({ type: "ready" });
    await harness.commands.get("gitkit.openBranchMap")!();
    await harness.commands.get("gitkit.openWorkflowStudio")!();
    const root = join(__dirname, "..", "..");
    for (const panel of harness.panels) {
      const icon = (panel.iconPath as Uri).fsPath;
      expect(icon.endsWith(join("media", "tab.svg")), panel.viewType).toBe(true);
    }
    expect(harness.panels).toHaveLength(2);
    const svg = readFileSync(join(root, "media", "tab.svg"), "utf8");
    // Coloured strokes, not currentColor (which shows grey on a tab).
    expect(svg).not.toContain("currentColor");
    expect(readFileSync(join(root, ".vscodeignore"), "utf8")).toContain("!media/tab.svg");
  });
});

describe("Workflow Studio", () => {
  async function openStudio(dir: string) {
    contexts.push(activateExtension());
    harness.folders = [dir];
    const sidebar = harness.resolveView(harness.views.get("gitkit.pulse")!);
    await sidebar.send({ type: "ready" });
    await harness.commands.get("gitkit.openWorkflowStudio")!();
    const studio = harness.panels.find((p) => p.viewType === "gitkit.workflowStudio")!;
    const posted = <T extends HostToStudio["type"]>(type: T) =>
      studio.webview.posted.filter((m) => (m as HostToStudio).type === type) as Extract<HostToStudio, { type: T }>[];
    return { studio, posted };
  }

  it("suggests jobs for the project, saves them, and reopens them for editing", async () => {
    const dir = makeRepo();
    commit(dir, "node project", { "package.json": JSON.stringify({ scripts: { lint: "eslint .", test: "vitest" } }) });
    const { studio, posted } = await openStudio(dir);

    await studio.webview.send({ type: "ready" });
    const suggestion = posted("init").at(-1)!.suggestion;
    expect(suggestion.jobs.map((j) => j.id)).toEqual(["lint", "test"]);

    await studio.webview.send({ type: "save", model: suggestion });
    const file = join(dir, ".github", "workflows", "ci.yml");
    expect(readFileSync(file, "utf8")).toContain("npm run lint");
    expect(posted("saved").at(-1)?.files).toEqual([
      { file: "ci.yml", byGitKit: true, summary: "CI · on push to main, on pull requests · 2 jobs" },
    ]);

    await studio.webview.send({ type: "open", file: "ci.yml" });
    expect(posted("opened").at(-1)).toMatchObject({ file: "ci.yml", imported: false, model: suggestion });
  });

  it("reads hand edits to a Studio file back as jobs and steps", async () => {
    const dir = makeRepo();
    commit(dir, "node project", { "package.json": JSON.stringify({ scripts: { test: "vitest" } }) });
    const { studio, posted } = await openStudio(dir);
    await studio.webview.send({ type: "ready" });
    await studio.webview.send({ type: "save", model: posted("init").at(-1)!.suggestion });
    const file = join(dir, ".github", "workflows", "ci.yml");
    writeFileSync(file, readFileSync(file, "utf8").replace("run: npm ci", "run: npm ci --ignore-scripts"));

    await studio.webview.send({ type: "open", file: "ci.yml" });
    const opened = posted("opened").at(-1)!;
    expect(opened.imported).toBe(true);
    expect(opened.model?.jobs[0].steps).toContainEqual({ run: "npm ci --ignore-scripts" });
  });

  it("shows why a broken workflow file can't be opened", async () => {
    const dir = makeRepo();
    write(dir, ".github/workflows/broken.yml", "name: [oops\n");
    write(dir, ".github/workflows/list.yml", "- not\n- a workflow\n");
    const { studio, posted } = await openStudio(dir);
    await studio.webview.send({ type: "ready" });

    await studio.webview.send({ type: "open", file: "broken.yml" });
    expect(posted("opened").at(-1)).toMatchObject({ model: null, explanation: { error: expect.any(String) } });
    await studio.webview.send({ type: "open", file: "list.yml" });
    expect(posted("opened").at(-1)).toMatchObject({ model: null, explanation: { error: /isn't a workflow/ } });
  });

  it("opens hand-written workflows as editable jobs and asks before replacing them", async () => {
    const dir = makeRepo();
    write(
      dir,
      ".github/workflows/release.yml",
      "name: Release\non: workflow_dispatch\njobs:\n  go:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    );
    const { studio, posted } = await openStudio(dir);
    await studio.webview.send({ type: "ready" });

    await studio.webview.send({ type: "open", file: "release.yml" });
    expect(posted("opened").at(-1)).toMatchObject({
      imported: true,
      model: { name: "Release", triggers: { manual: true }, jobs: [{ id: "go", steps: [{ run: "echo hi" }] }] },
    });

    const model: WorkflowModel = { ...posted("init").at(-1)!.suggestion, file: "release.yml" };
    harness.answers.push(undefined); // Don't replace.
    await studio.webview.send({ type: "save", model });
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toContain("name: Release");

    harness.answers.push("Replace");
    await studio.webview.send({ type: "save", model });
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toContain("Generated by GitKit");
  });

  it("opens straight on a workflow file from its menu, even when Studio is already open", async () => {
    const dir = makeRepo();
    write(
      dir,
      ".github/workflows/release.yml",
      "name: Release\non: workflow_dispatch\njobs:\n  go:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    );
    write(
      dir,
      ".github/workflows/docs.yml",
      "name: Docs\non: push\njobs:\n  d:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n",
    );
    contexts.push(activateExtension());
    harness.folders = [dir];
    await harness.resolveView(harness.views.get("gitkit.pulse")!).send({ type: "ready" });

    await harness.commands.get("gitkit.openWorkflowStudio")!(
      Uri.file(join(dir, ".github", "workflows", "release.yml")),
    );
    const studio = harness.panels.find((p) => p.viewType === "gitkit.workflowStudio")!;
    await studio.webview.send({ type: "ready" });
    const opened = () =>
      studio.webview.posted.filter((m) => (m as HostToStudio).type === "opened") as Extract<
        HostToStudio,
        { type: "opened" }
      >[];
    expect(opened().at(-1)).toMatchObject({ file: "release.yml", model: { name: "Release" } });

    await harness.commands.get("gitkit.openWorkflowStudio")!(Uri.file(join(dir, ".github", "workflows", "docs.yml")));
    expect(harness.panels.filter((p) => p.viewType === "gitkit.workflowStudio")).toHaveLength(1);
    expect(opened().at(-1)).toMatchObject({ file: "docs.yml", model: { name: "Docs" } });
  });

  it.each([
    [["code", "app", ".github", "workflows", "ci.yml"], { root: ["code", "app"], name: "ci.yml" }],
    [["code", "app", ".github", "workflows", "release.yaml"], { root: ["code", "app"], name: "release.yaml" }],
    [["code", "app", ".github", "workflows", "notes.md"], null],
    [["code", "app", ".github", "workflows", "nested", "ci.yml"], null],
    [["code", "app", "github", "workflows", "ci.yml"], null],
  ])("recognises workflow files: %j", (parts, expected) => {
    const file = join("/", ...parts);
    expect(workflowFile(file)).toEqual(expected && { root: join("/", ...expected.root), name: expected.name });
  });

  it("checks against GitHub's schema before saving, and saves only if asked to anyway", async () => {
    const dir = makeRepo();
    const { studio, posted } = await openStudio(dir);
    await studio.webview.send({ type: "ready" });
    const suggestion = posted("init").at(-1)!.suggestion;
    // A typo in "Job settings as YAML" that Studio's own checks can't know about.
    const model: WorkflowModel = {
      ...suggestion,
      jobs: suggestion.jobs.map((j, i) => (i === 0 ? { ...j, extra: { "timeout-minute": 5 } } : j)),
    };
    const file = join(dir, ".github", "workflows", "ci.yml");

    harness.answers.push(undefined);
    await studio.webview.send({ type: "save", model });
    const warning = harness.shown.find((s) => s.kind === "warning")!;
    expect(warning.message).toBe("GitHub would likely reject ci.yml: it doesn't match the workflow schema.");
    expect(warning.detail).toContain('GitHub doesn\'t know "timeout-minute"');
    expect(existsSync(file)).toBe(false);
    expect(posted("error").at(-1)?.message).toMatch(/^Not saved\. jobs › .*timeout-minute/);

    harness.answers.push("Save Anyway");
    await studio.webview.send({ type: "save", model });
    expect(readFileSync(file, "utf8")).toContain("timeout-minute: 5");
  });

  it("refuses to save an invalid workflow", async () => {
    const dir = makeRepo();
    const { studio, posted } = await openStudio(dir);
    await studio.webview.send({ type: "ready" });
    const model = { ...posted("init").at(-1)!.suggestion, jobs: [] };
    await studio.webview.send({ type: "save", model });
    expect(posted("error").at(-1)?.message).toBe("Add at least one job.");
    expect(existsSync(join(dir, ".github"))).toBe(false);
  });
});

describe("CI status", () => {
  function githubClone() {
    const { work } = makeDivergedClone();
    // Pretend the remote is on GitHub; fetch is stubbed, so nothing goes over the network.
    git(work, "remote", "set-url", "origin", "https://github.com/octo/demo.git");
    return work;
  }

  function stubGitHub(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    });
    return calls;
  }

  it("summarizes the checks on the latest pushed commit", async () => {
    const work = githubClone();
    const calls = stubGitHub(() => ({
      status: 200,
      body: {
        check_runs: [
          {
            name: "test",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/octo/demo/actions/runs/7/job/1",
            details_url: null,
          },
        ],
      },
    }));
    const ci = await readCi(await readRepo(work));
    const upstream = git(work, "rev-parse", "origin/main").trim();
    expect(calls[0].url).toBe(`https://api.github.com/repos/octo/demo/commits/${upstream}/check-runs?per_page=100`);
    expect(ci).toMatchObject({ state: "failure", failed: ["test"], runId: 7 });
  });

  it("asks to sign in for private repos, then uses the token", async () => {
    const work = githubClone();
    const calls = stubGitHub((_url, init) =>
      (init?.headers as Record<string, string>)?.Authorization
        ? { status: 200, body: { check_runs: [] } }
        : { status: 404 },
    );
    expect((await readCi(await readRepo(work)))?.state).toBe("signin");

    harness.session = { accessToken: "token-123" };
    expect((await readCi(await readRepo(work)))?.state).toBe("none");
    expect((calls.at(-1)!.init!.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("re-runs failed jobs", async () => {
    const work = githubClone();
    harness.session = { accessToken: "t" };
    const calls = stubGitHub(() => ({ status: 201 }));
    await rerunFailedJobs(await readRepo(work), 7);
    expect(calls[0]).toMatchObject({
      url: "https://api.github.com/repos/octo/demo/actions/runs/7/rerun-failed-jobs",
      init: { method: "POST" },
    });
  });

  it("shows nothing for repos that aren't on GitHub", async () => {
    const { work } = makeDivergedClone();
    expect(await readCi(await readRepo(work))).toBeNull();
  });

  it("appears in the panel after signing in", async () => {
    const work = githubClone();
    harness.config["gitkit.ciStatus"] = true;
    stubGitHub(() => ({
      status: 200,
      body: {
        check_runs: [{ name: "lint", status: "completed", conclusion: "success", html_url: null, details_url: null }],
      },
    }));
    const panel = await openPanel(work);
    harness.answers.push({ accessToken: "t" });
    await panel.send({ type: "signInGitHub" });
    expect(panel.repo().ci).toMatchObject({ state: "success", summary: "All 1 check passed" });
  });
});

describe("pull requests", () => {
  const BRANCH = "feat/health-endpoint";

  /** A clone whose feature branch has two pushed commits on top of main, "on GitHub". */
  function featureClone(): string {
    const { work } = makeDivergedClone();
    git(work, "stash", "-q", "--include-untracked");
    git(work, "switch", "-q", "-c", BRANCH, "origin/main");
    commit(work, "feat: add /health", { "health.txt": "ok\n" });
    commit(work, "test: cover /health", { "health.test.txt": "ok\n" }, "Checks the status code.");
    git(work, "push", "-q", "-u", "origin", BRANCH);
    // Only now pretend it's GitHub: the pushes above went to the real (local) remote.
    git(work, "remote", "set-url", "origin", "https://github.com/octo/demo.git");
    return work;
  }

  type Route = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;
  /** Fakes GitHub: each route answers the requests it knows; anything else is a test failure. */
  function stubGitHub(...routes: Route[]) {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = routes.map((r) => r(url, init)).find(Boolean);
      if (!answer) throw new Error(`Unexpected GitHub request: ${init?.method ?? "GET"} ${url}`);
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
    });
    return calls;
  }
  const noChecks: Route = (url) =>
    url.includes("/check-runs") ? { status: 200, body: { check_runs: [] } } : undefined;
  const graphql =
    (nodes: unknown[]): Route =>
    (url) =>
      url.endsWith("/graphql")
        ? { status: 200, body: { data: { repository: { pullRequests: { nodes } } } } }
        : undefined;
  const openPr = {
    number: 42,
    title: "feat: health endpoint",
    url: "https://github.com/octo/demo/pull/42",
    isDraft: false,
    baseRefName: "main",
    reviewDecision: "APPROVED",
    mergeable: "MERGEABLE",
    headRepositoryOwner: { login: "octo" },
    reviewThreads: { nodes: [{ isResolved: false }] },
  };

  it("reads the branch's PR in one GraphQL query when signed in", async () => {
    const work = featureClone();
    harness.session = { accessToken: "t" };
    const calls = stubGitHub(graphql([openPr]));
    const state = await readPullRequest(await readRepo(work));
    expect(state).toEqual({
      kind: "open",
      signedIn: true,
      pr: expect.objectContaining({ number: 42, review: "approved", unresolved: 1, mergeable: "clean" }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.github.com/graphql",
      method: "POST",
      body: { variables: { owner: "octo", repo: "demo", head: BRANCH } },
    });
  });

  it("reads public repos without signing in, through REST", async () => {
    const work = featureClone();
    const pull = { number: 7, title: "t", html_url: "https://github.com/octo/demo/pull/7", base: { ref: "main" } };
    const calls = stubGitHub((url) => {
      if (url.includes("/pulls?head=")) return { status: 200, body: [pull] };
      if (url.endsWith("/pulls/7")) return { status: 200, body: { ...pull, mergeable: false } };
      if (url.includes("/pulls/7/reviews")) return { status: 200, body: [{ user: { login: "a" }, state: "APPROVED" }] };
    });
    const state = await readPullRequest(await readRepo(work));
    expect(state).toMatchObject({
      kind: "open",
      signedIn: false,
      pr: { number: 7, review: "approved", mergeable: "conflicts", unresolved: null },
    });
    expect(calls[0].url).toBe(
      `https://api.github.com/repos/octo/demo/pulls?head=${encodeURIComponent(`octo:${BRANCH}`)}&state=open&per_page=1`,
    );
  });

  it("says there's no PR yet, and says nothing on main, unpushed branches or errors", async () => {
    const work = featureClone();
    stubGitHub((url) => (url.includes("/pulls?head=") ? { status: 200, body: [] } : undefined));
    expect(await readPullRequest(await readRepo(work))).toEqual({ kind: "none", head: BRANCH, base: "main" });

    git(work, "switch", "-q", "-c", "local-only");
    expect(await readPullRequest(await readRepo(work))).toBeNull();
    git(work, "switch", "-q", "main");
    expect(await readPullRequest(await readRepo(work))).toBeNull();

    git(work, "switch", "-q", BRANCH);
    stubGitHub(() => ({ status: 500 }));
    expect(await readPullRequest(await readRepo(work))).toBeNull();
  });

  it("shows the PR in the panel with CI", async () => {
    const work = featureClone();
    harness.config["gitkit.ciStatus"] = true;
    harness.session = { accessToken: "t" };
    stubGitHub(noChecks, graphql([openPr]));
    const panel = await openPanel(work);
    await panel.send({ type: "signInGitHub" });
    expect(panel.repo().pr).toMatchObject({ kind: "open", pr: { number: 42 } });
  });

  /** A panel on the feature branch that knows it has no PR yet. */
  async function panelWithoutPr(...routes: Route[]) {
    const work = featureClone();
    harness.config["gitkit.ciStatus"] = true;
    harness.session = { accessToken: "t" };
    const calls = stubGitHub(...routes, noChecks, graphql([]));
    const panel = await openPanel(work);
    await panel.send({ type: "signInGitHub" });
    expect(panel.repo().pr).toEqual({ kind: "none", head: BRANCH, base: "main" });
    return { panel, calls };
  }
  const created: Route = (url, init) =>
    url.endsWith("/repos/octo/demo/pulls") && init?.method === "POST"
      ? { status: 201, body: { number: 43, html_url: "https://github.com/octo/demo/pull/43", base: { ref: "main" } } }
      : undefined;

  it("opens a PR with a title and description drafted from the pushed commits", async () => {
    const { panel, calls } = await panelWithoutPr(created);
    harness.answers.push(
      ([value]: string[]) => value,
      (items: { mode: string }[]) => items.find((i) => i.mode === "create"),
    );
    await panel.send({ type: "createPr" });

    const title = harness.shown.find((s) => s.kind === "inputBox")!;
    expect(title.detail).toBe(`${BRANCH} → main, 2 commits`);
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/pulls"))?.body).toEqual({
      title: "feat: health endpoint",
      body: "- feat: add /health\n- test: cover /health",
      base: "main",
      head: BRANCH,
      draft: false,
    });
    expect(harness.shown.some((s) => s.kind === "info" && s.message === "Opened pull request #43.")).toBe(true);
  });

  it("creates drafts, and uses the title as edited", async () => {
    const { panel, calls } = await panelWithoutPr(created);
    harness.answers.push("My own title  ", (items: { mode: string }[]) => items.find((i) => i.mode === "draft"));
    await panel.send({ type: "createPr" });
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/pulls"))?.body).toMatchObject({
      title: "My own title",
      draft: true,
    });
  });

  it("can hand over to GitHub's own page instead, sending nothing", async () => {
    const { panel, calls } = await panelWithoutPr();
    harness.answers.push(
      ([value]: string[]) => value,
      (items: { mode: string }[]) => items.find((i) => i.mode === "web"),
    );
    await panel.send({ type: "createPr" });
    expect(calls.some((c) => c.method === "POST" && !c.url.endsWith("/graphql"))).toBe(false);
    const url = new URL(harness.opened.at(-1)!);
    expect(url.pathname).toBe(`/octo/demo/compare/main...${BRANCH}`);
    expect(url.searchParams.get("title")).toBe("feat: health endpoint");
  });

  it("sends nothing when the title is cancelled", async () => {
    const { panel, calls } = await panelWithoutPr();
    harness.answers.push(undefined);
    await panel.send({ type: "createPr" });
    expect(calls.some((c) => c.method === "POST" && !c.url.endsWith("/graphql"))).toBe(false);
    expect(harness.shown.some((s) => s.kind === "quickPick")).toBe(false);
  });

  it("explains why GitHub refused", async () => {
    const { panel } = await panelWithoutPr((url, init) =>
      init?.method === "POST" && url.endsWith("/pulls")
        ? {
            status: 422,
            body: {
              message: "Validation Failed",
              errors: [{ message: "A pull request already exists for octo:feat/health-endpoint." }],
            },
          }
        : undefined,
    );
    harness.answers.push(
      ([value]: string[]) => value,
      (items: { mode: string }[]) => items.find((i) => i.mode === "create"),
    );
    await panel.send({ type: "createPr" });
    expect(panel.posted("error").at(-1)?.error.message).toBe(
      "GitHub didn't open the pull request: A pull request already exists for octo:feat/health-endpoint.",
    );
  });
});

describe("worktrees", () => {
  function repoWithWorktree() {
    const app = makeRepo();
    // Its own temp folder: next to the repo would be the shared temp dir, shared by every test.
    const feature = join(tempDir(), "feature-login");
    git(app, "worktree", "add", "-q", "-b", "feature/login", feature);
    return { app, feature };
  }

  /** A repo in its own temp folder, so worktrees created next to it stay inside that folder. */
  function appRepo() {
    const base = tempDir();
    const app = initRepo(join(base, "app"));
    commit(app, "first", { "a.txt": "one\n", ".gitignore": ".env\nnode_modules/\n" });
    return { base, app };
  }
  const worktreeList = (dir: string) => git(dir, "worktree", "list", "--porcelain");
  const modal = () => harness.shown.filter((s) => s.kind === "info" && s.detail !== undefined).at(-1)!;

  describe("creating", () => {
    it("makes one next to the repo for a new branch, copies listed files and runs the setup command", async () => {
      const { base, app } = appRepo();
      write(app, ".env", "SECRET=1\n");
      harness.config["gitkit.worktrees.setupCommand"] = "npm install";
      harness.config["gitkit.worktrees.copyFiles"] = [".env", "missing.json"];
      const panel = await openPanel(app);
      harness.answers.push("agent/fix-login", "Create", undefined);
      await panel.send({ type: "newWorktree" });

      // Git (and so the extension) reports the long folder name; the temp dir may be an 8.3 short one.
      const target = join(realPath(base), "app.worktrees", "agent-fix-login");
      expect(modal().message).toBe(`Create a worktree for agent/fix-login (new, from main) at ${target}?`);
      expect(modal().detail).toContain(formatCommand(["worktree", "add", "-b", "agent/fix-login", target, "main"]));
      expect(modal().detail).toContain(
        'Then: copy .env from the main checkout; run "npm install" in a terminal there.',
      );
      expect(modal().detail).toContain("Not copied: missing.json (not found).");

      expect(worktreeList(app)).toContain("branch refs/heads/agent/fix-login");
      expect(readFileSync(join(target, ".env"), "utf8")).toBe("SECRET=1\n");
      expect(harness.terminals).toEqual([
        { name: "Setup: agent-fix-login", cwd: target, sent: ["npm install"], shown: true },
      ]);
      expect(panel.repo().worktrees.map((w) => w.branch)).toEqual(["main", "agent/fix-login"]);
    });

    it("can put it inside the repo, kept out of git status without touching .gitignore", async () => {
      const { app } = appRepo();
      harness.config["gitkit.worktrees.location"] = "inside";
      const panel = await openPanel(app);
      harness.answers.push("agent/x", "Create", undefined);
      await panel.send({ type: "newWorktree" });

      expect(existsSync(join(app, ".worktrees", "agent-x", "a.txt"))).toBe(true);
      expect(readFileSync(join(app, ".git", "info", "exclude"), "utf8")).toContain("/.worktrees/\n");
      expect(git(app, "status", "--porcelain")).toBe("");
      expect(readFileSync(join(app, ".gitignore"), "utf8")).toBe(".env\nnode_modules/\n");
    });

    it("checks out an existing branch without asking where to start, and opens it on request", async () => {
      const { base, app } = appRepo();
      git(app, "branch", "old-work");
      const panel = await openPanel(app);
      harness.answers.push("old-work", "Create", "Open in New Window");
      await panel.send({ type: "newWorktree" });
      const target = join(base, "app.worktrees", "old-work");
      expect(harness.shown.some((s) => s.kind === "quickPick")).toBe(false);
      expect(worktreeList(app)).toContain("branch refs/heads/old-work");
      const opened = harness.executed.find((e) => e.command === "vscode.openFolder")!;
      expect(samePath((opened.args[0] as Uri).fsPath, target)).toBe(true);
    });

    it("asks where a new branch starts when there's a choice", async () => {
      const { app } = appRepo();
      git(app, "switch", "-q", "-c", "feat/current");
      commit(app, "on feat/current");
      const panel = await openPanel(app);
      harness.answers.push(
        "agent/y",
        (items: { ref: string }[]) => items.find((i) => i.ref === "feat/current"),
        "Create",
        undefined,
      );
      await panel.send({ type: "newWorktree" });
      expect(git(app, "rev-parse", "agent/y")).toBe(git(app, "rev-parse", "feat/current"));
    });

    it("creates nothing when cancelled", async () => {
      const { base, app } = appRepo();
      const panel = await openPanel(app);
      harness.answers.push("agent/z", undefined);
      await panel.send({ type: "newWorktree" });
      expect(existsSync(join(base, "app.worktrees"))).toBe(false);
      expect(worktreeList(app)).not.toContain("agent/z");
    });

    it("says where a branch is open instead of letting git fail", async () => {
      const { app } = repoWithWorktree();
      const panel = await openPanel(app);
      harness.answers.push("feature/login");
      await panel.send({ type: "newWorktree" });
      expect(panel.posted("error").at(-1)?.error.message).toMatch(/^feature\/login is open in another worktree/);
    });
  });

  describe("removing and cleaning up", () => {
    it("warns about uncommitted files, removes it, then offers to delete its merged branch", async () => {
      const { app, feature } = repoWithWorktree();
      write(feature, "scratch.txt", "agent output\n");
      const panel = await openPanel(app);
      const path = panel.repo().worktrees[1].path;
      harness.answers.push("Remove worktree", "Delete Branch");
      await panel.send({ type: "action", request: { type: "removeWorktree", path } });

      const warning = harness.shown.find((s) => s.kind === "warning")!;
      expect(warning.message).toMatch(/It has 1 uncommitted file, which will be deleted\./);
      expect(existsSync(feature)).toBe(false);
      expect(harness.shown.some((s) => s.message.includes("feature/login is merged into main"))).toBe(true);
      expect(git(app, "branch", "--list", "feature/login")).toBe("");
      expect(panel.repo().worktrees).toEqual([]);
    });

    it("closes terminals open in the worktree first, since Windows can't delete a folder in use", async () => {
      const { app, feature } = repoWithWorktree();
      const { window } = await import("../mocks/vscode");
      const agent = window.createTerminal({ name: "agent", cwd: join(feature, "src") });
      window.createTerminal({ name: "elsewhere", cwd: app });
      const panel = await openPanel(app);
      harness.answers.push("Remove worktree", undefined);
      await panel.send({ type: "action", request: { type: "removeWorktree", path: panel.repo().worktrees[1].path } });

      const warning = harness.shown.find((s) => s.kind === "warning")!;
      expect(warning.message).toMatch(/The terminal open there \(agent\) will be closed first\.$/);
      expect(window.terminals.map((t) => t.name)).toEqual(["elsewhere"]);
      expect(existsSync(feature)).toBe(false);
      void agent;
    });

    it("counts the worktree as removed when only its emptied folder is still in use", async () => {
      const { app, feature } = repoWithWorktree();
      // A process standing in the folder, like a shell that hasn't finished exiting. On Windows
      // that blocks deleting the folder itself (not its files); elsewhere nothing is blocked.
      const shell = spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { cwd: feature, stdio: "ignore" });
      try {
        const panel = await openPanel(app);
        harness.answers.push("Remove worktree", "Delete Branch");
        await panel.send({ type: "action", request: { type: "removeWorktree", path: panel.repo().worktrees[1].path } });
        expect(panel.posted("error")).toEqual([]);
        expect(git(app, "worktree", "list")).not.toContain("feature-login");
        // Removal worked, so the merged branch is offered for deletion as usual.
        expect(git(app, "branch", "--list", "feature/login")).toBe("");
      } finally {
        shell.kill();
      }
    });

    it("explains a folder in use in plain words", () => {
      const locked = new Error("error: failed to delete 'C:/w/agent': Permission denied");
      expect(explainFailure(["worktree", "remove", "C:/w/agent"], locked)).toMatch(
        /^Couldn't delete the worktree's folder: a program is still using it/,
      );
      expect(explainFailure(["push"], locked)).toBe("error: failed to delete 'C:/w/agent': Permission denied");
    });

    it("keeps an unmerged branch without asking", async () => {
      const { app, feature } = repoWithWorktree();
      commit(feature, "work not on main yet");
      const panel = await openPanel(app);
      harness.answers.push("Remove worktree");
      await panel.send({ type: "action", request: { type: "removeWorktree", path: panel.repo().worktrees[1].path } });
      expect(existsSync(feature)).toBe(false);
      expect(harness.shown.some((s) => s.message.includes("delete the branch too"))).toBe(false);
      expect(git(app, "branch", "--list", "feature/login")).toContain("feature/login");
    });

    it("leaves locked worktrees alone, and locks and unlocks on request", async () => {
      const { app, feature } = repoWithWorktree();
      const panel = await openPanel(app);
      const path = panel.repo().worktrees[1].path;
      await panel.send({ type: "action", request: { type: "lockWorktree", path } });
      expect(panel.repo().worktrees[1].locked).toBe("");
      await panel.send({ type: "action", request: { type: "removeWorktree", path } });
      expect(panel.posted("error").at(-1)?.error.message).toBe("It's locked. Unlock it first.");
      expect(existsSync(feature)).toBe(true);
      await panel.send({ type: "action", request: { type: "unlockWorktree", path } });
      expect(panel.repo().worktrees[1].locked).toBeNull();
    });

    it("forgets worktrees whose folder was deleted by hand", async () => {
      const { app, feature } = repoWithWorktree();
      rmSync(feature, { recursive: true, force: true });
      const panel = await openPanel(app);
      expect(panel.repo().worktrees[1].prunable).not.toBeNull();
      await panel.send({ type: "action", request: { type: "pruneWorktrees" } });
      expect(panel.repo().worktrees).toEqual([]);
    });
  });

  it("leaves branches open in a worktree out of 'Clean up merged branches'", async () => {
    const { work } = makeDivergedClone();
    git(work, "branch", "done", "origin/main");
    git(work, "worktree", "add", "-q", "-b", "agent/merged", join(tempDir(), "agent"), "origin/main");
    const panel = await openPanel(work);
    harness.answers.push((items: { label: string }[]) => items, "Delete branches");
    await panel.provider.cleanupBranches();

    const offered = (harness.shown.find((s) => s.kind === "quickPick")!.items as { label: string }[]).map(
      (i) => i.label,
    );
    expect(offered).toContain("done");
    expect(offered).not.toContain("agent/merged");
    expect(git(work, "branch", "--list", "done")).toBe("");
    expect(git(work, "branch", "--list", "agent/merged")).toContain("agent/merged");
  });

  it("marks branches open in another worktree in the branch switcher, and opens that worktree", async () => {
    const { app, feature } = repoWithWorktree();
    const panel = await openPanel(app);
    harness.answers.push((items: { label: string; description?: string }[]) =>
      items.find((i) => i.label.includes("feature/login")),
    );
    await panel.send({ type: "pickBranch" });
    const item = (
      harness.shown.find((s) => s.kind === "quickPick")!.items as { label: string; description?: string }[]
    ).find((i) => i.label.includes("feature/login"))!;
    expect(item.label).toBe("$(folder-opened) feature/login");
    expect(item.description).toMatch(/^open in a worktree: /);
    const opened = harness.executed.find((e) => e.command === "vscode.openFolder")!;
    expect(samePath((opened.args[0] as Uri).fsPath, feature)).toBe(true);
  });

  it("lists the repo's worktrees in the panel", async () => {
    const { app } = repoWithWorktree();
    const panel = await openPanel(app);
    expect(panel.repo().worktrees.map((w) => [w.branch, w.current])).toEqual([
      ["main", true],
      ["feature/login", false],
    ]);
  });

  it("opens a worktree in a new window, or adds it to this one", async () => {
    const { app } = repoWithWorktree();
    const panel = await openPanel(app);
    const path = panel.repo().worktrees[1].path;

    await panel.send({ type: "openWorktree", path, newWindow: true });
    const opened = harness.executed.find((e) => e.command === "vscode.openFolder")!;
    expect((opened.args[0] as Uri).fsPath).toBe(path);
    expect(opened.args[1]).toEqual({ forceNewWindow: true });

    await panel.send({ type: "openWorktree", path, newWindow: false });
    expect(harness.folders).toEqual([app, path]);
    // Adding it twice doesn't add a second copy.
    await panel.send({ type: "openWorktree", path, newWindow: false });
    expect(harness.folders).toHaveLength(2);
  });

  it("only opens folders git listed as this repo's worktrees", async () => {
    const { app } = repoWithWorktree();
    const panel = await openPanel(app);
    const elsewhere = makeRepo();
    await panel.send({ type: "openWorktree", path: elsewhere, newWindow: true });
    await panel.send({ type: "openWorktree", path: app, newWindow: true }); // This window's own.
    expect(harness.executed.some((e) => e.command === "vscode.openFolder")).toBe(false);
  });
});

describe("checkpoints", () => {
  const terminal = (commandLine: string, cwd: string) =>
    harness.shellExecutions.fire({
      execution: { commandLine: { value: commandLine }, cwd: Uri.file(cwd) },
      shellIntegration: {},
    });

  it("saves one by hand, and says when there's nothing to save", async () => {
    const app = makeRepo();
    const panel = await openPanel(app);
    await panel.send({ type: "checkpoint" });
    expect(harness.shown.at(-1)).toMatchObject({
      kind: "status",
      message: "GitKit: nothing changed since the last commit",
    });

    write(app, "new.txt", "agent output\n");
    await panel.send({ type: "checkpoint" });
    expect(panel.repo().checkpoints.map((c) => c.reason)).toEqual(["saved by hand"]);
  });

  it("saves one when a coding agent starts in a terminal here, once per minute", async () => {
    const app = makeRepo();
    write(app, "work.txt", "in progress\n");
    const panel = await openPanel(app);

    terminal("git status", app);
    terminal("npx @anthropic-ai/claude-code --continue", app);
    await panel.provider.whenIdle();
    expect(panel.repo().checkpoints.map((c) => c.reason)).toEqual(["before claude"]);
    expect(harness.shown.some((s) => s.message === "GitKit: checkpoint saved before claude started")).toBe(true);

    write(app, "work.txt", "changed again\n");
    terminal("claude", app);
    await panel.provider.whenIdle();
    expect(panel.repo().checkpoints).toHaveLength(1);
  });

  it("checkpoints the worktree the terminal is in, even one opened by path", async () => {
    const app = makeRepo();
    const tree = join(tempDir(), "agent");
    git(app, "worktree", "add", "-q", "-b", "agent/x", tree);
    write(tree, "agent.txt", "agent work\n");
    const panel = await openPanel(app);
    terminal("codex", join(tree, "src"));
    await panel.provider.whenIdle();
    expect((await readCheckpointState(tree)).checkpoints.map((c) => c.reason)).toEqual(["before codex"]);
    expect((await readCheckpointState(app)).checkpoints).toEqual([]);
  });

  it("recognises the worktree however the terminal spells its folder (junction, symlink, short name)", async () => {
    const app = makeRepo();
    const tree = join(tempDir(), "agent");
    git(app, "worktree", "add", "-q", "-b", "agent/x", tree);
    write(tree, "agent.txt", "agent work\n");
    // Another name for the same folder, like an 8.3 short path on Windows.
    const link = join(tempDir(), "link");
    symlinkSync(tree, link, "junction");
    const panel = await openPanel(app);
    terminal("codex", join(link, "src", "not-created-yet"));
    await panel.provider.whenIdle();
    expect((await readCheckpointState(tree)).checkpoints.map((c) => c.reason)).toEqual(["before codex"]);
  });

  it("does nothing outside this window's repos, or when turned off", async () => {
    const app = makeRepo();
    const other = makeRepo();
    write(app, "x.txt", "x\n");
    write(other, "y.txt", "y\n");
    harness.config["gitkit.checkpoints.onAgentStart"] = false;
    const panel = await openPanel(app);
    terminal("claude", app);
    harness.config["gitkit.checkpoints.onAgentStart"] = true;
    terminal("claude", other);
    await panel.provider.whenIdle();
    expect(panel.repo().checkpoints).toEqual([]);
    expect(await listCheckpoints(other)).toEqual([]);
  });

  it("restores files from a checkpoint, saving how things were first", async () => {
    const app = makeRepo();
    write(app, "a.txt", "good version\n");
    const panel = await openPanel(app);
    await panel.send({ type: "checkpoint" });
    write(app, "a.txt", "broken by an agent\n");
    write(app, "added-later.txt", "stays\n");

    harness.answers.push("Restore checkpoint");
    await panel.send({
      type: "action",
      request: { type: "restoreCheckpoint", hash: panel.repo().checkpoints[0].hash },
    });
    expect(readFileSync(join(app, "a.txt"), "utf8")).toBe("good version\n");
    expect(readFileSync(join(app, "added-later.txt"), "utf8")).toBe("stays\n");
    // The broken state is a checkpoint too, so the restore can be undone.
    const [newest] = panel.repo().checkpoints;
    expect(newest.reason).toBe("before restoring a checkpoint");
    expect(git(app, "show", `${newest.hash}:a.txt`)).toBe("broken by an agent\n");
  });

  it("checkpoints a worktree before removing it, so its files can be recovered as a branch", async () => {
    const app = makeRepo();
    const tree = join(tempDir(), "agent");
    git(app, "worktree", "add", "-q", "-b", "agent/x", tree);
    write(tree, "unsaved.txt", "an agent's uncommitted work\n");
    const panel = await openPanel(app);
    harness.answers.push("Remove worktree", undefined);
    await panel.send({ type: "action", request: { type: "removeWorktree", path: panel.repo().worktrees[1].path } });
    expect(existsSync(tree)).toBe(false);

    const [saved] = panel.repo().removedCheckpoints;
    expect(saved).toMatchObject({ worktree: "agent", reason: "before removing the worktree" });
    await panel.send({
      type: "action",
      request: { type: "recoverBranch", name: "checkpoint/agent", hash: saved.hash },
    });
    expect(git(app, "show", "checkpoint/agent:unsaved.txt")).toBe("an agent's uncommitted work\n");
  });

  it("lists the same agents by default as the setting's documented default", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(pkg.contributes.configuration.properties["gitkit.checkpoints.agentCommands"].default).toEqual(
      DEFAULT_AGENTS,
    );
  });
});

describe("auto-fetch", () => {
  it("checks the remote by itself when it has never been fetched", async () => {
    const { work, remote } = makeDivergedClone();
    // Someone else pushes a new commit.
    const other = join(work, "..", "other");
    git(join(work, ".."), "clone", "-q", remote, other);
    commit(other, "from a teammate");
    git(other, "push", "-q", "origin", "HEAD:main");

    harness.config["gitkit.autoFetchMinutes"] = 5;
    const panel = await openPanel(work);
    await vi.waitFor(() => expect(panel.repo().lastFetch).not.toBeNull(), { timeout: 20_000 });
    await vi.waitFor(() => expect(panel.repo().status.behind).toBe(2), { timeout: 20_000 });
  });
});

// Keeps the unused-import linter honest about writeFileSync being available for future tests.
void writeFileSync;

describe("branch-to-branch actions from the Branch Map", () => {
  it("forecasts conflicts in the confirmation before merging", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "feat");
    commit(dir, "feat edit", { "a.txt": "feat\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "main edit", { "a.txt": "main\n" });
    const panel = await openPanel(dir);

    harness.answers.push(undefined); // Look, then cancel.
    await panel.send({ type: "action", request: { type: "mergeBranch", branch: "feat" } });
    expect(harness.shown.at(-1)?.message).toMatch(/Merge feat into main\? Expect conflicts in a\.txt\./);
    expect(panel.repo().operation).toBeNull();
  });

  it("says when a merge is clean, and merges into another branch by switching first", async () => {
    const dir = makeRepo();
    git(dir, "branch", "release");
    git(dir, "switch", "-q", "-c", "feat");
    commit(dir, "feature", { "f.txt": "f\n" });
    const panel = await openPanel(dir);

    harness.answers.push("Merge into release");
    await panel.send({ type: "action", request: { type: "switchAndMerge", target: "release", source: "feat" } });
    expect(harness.shown.at(-1)?.message).toMatch(/It merges cleanly/);
    expect(git(dir, "branch", "--show-current").trim()).toBe("release");
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("feature");
  });

  it("rebases the current branch onto another", async () => {
    const dir = makeRepo();
    git(dir, "switch", "-q", "-c", "feat");
    commit(dir, "feature", { "f.txt": "f\n" });
    git(dir, "switch", "-q", "main");
    commit(dir, "main moved", { "m.txt": "m\n" });
    git(dir, "switch", "-q", "feat");
    const panel = await openPanel(dir);

    harness.answers.push("Rebase");
    await panel.send({ type: "action", request: { type: "rebaseOnto", branch: "main" } });
    expect(git(dir, "log", "--format=%s").trim().split("\n")).toEqual(["feature", "main moved", "first"]);
    expect(git(dir, "rev-parse", "refs/gitkit/backup/feat").trim()).toBeTruthy();
  });
});
