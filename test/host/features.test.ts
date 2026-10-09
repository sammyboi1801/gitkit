import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activate } from "../../src/extension";
import { readCi, rerunFailedJobs } from "../../src/github/client";
import { readRepo } from "../../src/git/repo";
import type { HostToStudio } from "../../src/shared/messages";
import type { WorkflowModel } from "../../src/workflow/model";
import { commit, git, makeDivergedClone, makeRepo, write } from "../fixtures/repos";
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
      "gitkit.cleanupBranches",
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
    expect(posted("saved").at(-1)?.files).toEqual([{ file: "ci.yml", byGitKit: true }]);

    await studio.webview.send({ type: "open", file: "ci.yml" });
    expect(posted("opened").at(-1)).toMatchObject({ file: "ci.yml", editedByHand: false, model: suggestion });
  });

  it("explains hand-written workflows and asks before replacing them", async () => {
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
      model: null,
      explanation: { name: "Release", triggers: ["manually from the Actions tab"] },
    });

    const model: WorkflowModel = { ...posted("init").at(-1)!.suggestion, file: "release.yml" };
    harness.answers.push(undefined); // Don't replace.
    await studio.webview.send({ type: "save", model });
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toContain("name: Release");

    harness.answers.push("Replace");
    await studio.webview.send({ type: "save", model });
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toContain("Generated by GitKit");
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
