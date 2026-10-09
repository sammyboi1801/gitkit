import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import App from "../../webview/pulse/App.svelte";
import Changes from "../../webview/pulse/Changes.svelte";
import ConflictView from "../../webview/pulse/ConflictView.svelte";
import Graph from "../../webview/pulse/Graph.svelte";
import Header from "../../webview/pulse/Header.svelte";
import History from "../../webview/pulse/History.svelte";
import Remote from "../../webview/pulse/Remote.svelte";
import Repos from "../../webview/pulse/Repos.svelte";
import Stashes from "../../webview/pulse/Stashes.svelte";
import { commitOf, file, repoState } from "./state";
import { sent } from "./setup";

const lastSent = () => sent.at(-1);
const button = (name: RegExp | string) => screen.getByRole("button", { name });

describe("Header", () => {
  it("says where you stand and highlights the one action that makes sense", () => {
    render(Header, { props: { repo: repoState({ status: { ahead: 2 } }), busy: null } });
    expect(screen.getByText("2 commits ready to push")).toBeTruthy();
    expect(button(/Push/).classList.contains("primary")).toBe(true);
    expect(button(/Pull/).classList.contains("primary")).toBe(false);
  });

  it("shows the exact command on hover and sends the action on click", async () => {
    render(Header, { props: { repo: repoState({ status: { behind: 3 } }), busy: null } });
    expect(button(/Pull/).getAttribute("title")).toBe("git pull --ff-only");
    await fireEvent.click(button(/Pull/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "pull" } });
  });

  it("offers Publish for a branch that isn't on the remote, and Oops and the branch picker", async () => {
    render(Header, { props: { repo: repoState({ status: { branch: "feat/x", upstream: null } }), busy: null } });
    expect(button(/Publish/).getAttribute("title")).toBe("git push -u origin feat/x");
    await fireEvent.click(button(/Oops/));
    expect(lastSent()).toEqual({ type: "oops" });
    await fireEvent.click(button(/feat\/x/));
    expect(lastSent()).toEqual({ type: "pickBranch" });
  });

  it("disables everything while an action runs", () => {
    render(Header, { props: { repo: repoState({ status: { ahead: 1 } }), busy: "Push" } });
    for (const name of [/Pull/, /Push/, /Sync/, /Oops/])
      expect((button(name) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Changes", () => {
  const changed = repoState({
    status: {
      files: [
        file("src/app.ts", { index: "M", worktree: null, indexStats: { added: 3, removed: 1, binary: false } }),
        file("README.md", { worktreeStats: { added: 5, removed: 0, binary: false } }),
        file("notes.txt", { worktree: "?", untracked: true }),
      ],
    },
  });

  it("groups staged and unstaged files with line counts", () => {
    render(Changes, { props: { repo: changed, busy: null, conflictBlocks: {} } });
    expect(screen.getByText("Staged")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getAllByText("+3").length).toBeGreaterThan(0);
    expect(screen.getByText("new")).toBeTruthy();
  });

  it("commits with Ctrl+Enter and previews the exact command while typing", async () => {
    render(Changes, { props: { repo: changed, busy: null, conflictBlocks: {} } });
    const box = screen.getByRole("textbox");
    await fireEvent.input(box, { target: { value: "fix: login" } });
    expect(screen.getByText('git commit -m "fix: login"')).toBeTruthy();
    await fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(lastSent()).toEqual({ type: "action", request: { type: "commit", message: "fix: login" } });
  });

  it("says Commit all when nothing is staged", async () => {
    const unstaged = repoState({ status: { files: [file("a.txt")] } });
    render(Changes, { props: { repo: unstaged, busy: null, conflictBlocks: {} } });
    await fireEvent.input(screen.getByRole("textbox"), { target: { value: "wip" } });
    expect(button(/Commit all/)).toBeTruthy();
    expect(screen.getByText("git add -A && git commit -m wip")).toBeTruthy();
  });

  it("stages and discards single files", async () => {
    render(Changes, { props: { repo: changed, busy: null, conflictBlocks: {} } });
    await fireEvent.click(screen.getAllByTitle("git add -- README.md")[0]);
    expect(lastSent()).toEqual({ type: "action", request: { type: "stage", paths: ["README.md"] } });
    await fireEvent.click(
      screen.getByTitle(/git stash push --include-untracked -m "GitKit discard: README.md" -- README.md/),
    );
    expect(lastSent()).toEqual({ type: "action", request: { type: "discard", paths: ["README.md"] } });
  });

  it("shows a single line when the tree is clean, and a hint instead of a commit box mid-merge", () => {
    const { unmount } = render(Changes, { props: { repo: repoState(), busy: null, conflictBlocks: {} } });
    expect(screen.getByText("Working tree clean")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    unmount();

    const merging = repoState({
      operation: "merge",
      status: { files: [file("a.txt", { conflicted: true, index: "U", worktree: "U" })] },
    });
    render(Changes, { props: { repo: merging, busy: null, conflictBlocks: {} } });
    expect(screen.getByText(/press Continue above/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("ConflictView", () => {
  const block = {
    index: 0,
    line: 3,
    oursLabel: "HEAD",
    theirsLabel: "feat/label",
    ours: ["Go"],
    base: null,
    theirs: ["Click me"],
  };

  it("labels sides in plain words and resolves on click", async () => {
    render(ConflictView, {
      props: { repo: repoState({ operation: "merge" }), path: "a.ts", blocks: [block], busy: null },
    });
    expect(sent[0]).toEqual({ type: "conflictDetails", path: "a.ts" });
    expect(screen.getByText("Yours")).toBeTruthy();
    expect(screen.getByText("Incoming")).toBeTruthy();
    await fireEvent.click(button("Keep incoming"));
    expect(lastSent()).toEqual({ type: "resolveConflict", path: "a.ts", block: 0, choice: "theirs" });
    await fireEvent.click(button(/Open in the merge editor/));
    expect(lastSent()).toEqual({ type: "openMergeEditor", path: "a.ts" });
  });

  it("says Upstream and Your commit during a rebase, where ours and theirs swap", () => {
    render(ConflictView, {
      props: { repo: repoState({ operation: "rebase" }), path: "a.ts", blocks: [block], busy: null },
    });
    expect(screen.getByText("Upstream")).toBeTruthy();
    expect(screen.getByText("Your commit")).toBeTruthy();
    expect(button("Keep your commit")).toBeTruthy();
  });

  it("offers Mark resolved once no markers are left", async () => {
    render(ConflictView, { props: { repo: repoState({ operation: "merge" }), path: "a.ts", blocks: [], busy: null } });
    await fireEvent.click(button(/Mark resolved/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "stage", paths: ["a.ts"] } });
  });
});

describe("Remote card", () => {
  it("shows drift from main, the conflict forecast and the right update strategy", async () => {
    const repo = repoState({
      status: { branch: "feat/login", upstream: "origin/feat/login" },
      base: {
        ref: "origin/main",
        name: "main",
        ahead: 2,
        behind: 3,
        forkPoint: "c1",
        conflicts: ["app.py"],
        isCurrent: false,
      },
    });
    render(Remote, { props: { repo, busy: null, fetching: false } });
    expect(screen.getByText("3 new since you branched")).toBeTruthy();
    expect(screen.getByText(/would conflict in app\.py/)).toBeTruthy();
    await fireEvent.click(button(/Merge main/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "updateFromBase" } });
  });

  it("reads remote activity as sentences", () => {
    const repo = repoState({
      activity: [
        {
          ref: "origin/main",
          time: Math.floor(Date.now() / 1000) - 300,
          kind: "fetch",
          byYou: false,
          commits: 2,
          authors: ["Alex Chen"],
        },
      ],
    });
    render(Remote, { props: { repo, busy: null, fetching: false } });
    const row = screen.getByText("Alex Chen").closest("li")!;
    expect(row.textContent).toMatch(/Alex Chen\s*added 2 commits to\s*origin\/main\s*5m ago/);
  });

  it("shows CI results, with re-run for failures and sign-in when needed", async () => {
    const failing = repoState({
      ci: {
        state: "failure",
        sha: "c2",
        summary: "1 of 2 checks failed",
        failed: ["test"],
        url: "https://github.com/o/r/actions/runs/7",
        runId: 7,
      },
    });
    const { unmount } = render(Remote, { props: { repo: failing, busy: null, fetching: false } });
    expect(screen.getByText(/1 of 2 checks failed: test/)).toBeTruthy();
    await fireEvent.click(button("Re-run"));
    expect(lastSent()).toEqual({ type: "rerunFailed" });
    unmount();

    const signin = repoState({
      ci: { state: "signin", sha: "c2", summary: "Sign in to GitHub to see CI", failed: [], url: "x", runId: null },
    });
    render(Remote, { props: { repo: signin, busy: null, fetching: false } });
    await fireEvent.click(button("Sign in"));
    expect(lastSent()).toEqual({ type: "signInGitHub" });
  });

  it("is hidden for repos without a remote", () => {
    const { container } = render(Remote, { props: { repo: repoState({ remotes: [] }), busy: null, fetching: false } });
    expect(container.textContent?.trim()).toBe("");
  });
});

describe("Repositories list", () => {
  const repos = [
    {
      root: "/w/api",
      label: "api",
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 2,
      changes: 0,
      conflicts: 0,
    },
    {
      root: "/w/ui",
      label: "packages/ui",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      changes: 1,
      conflicts: 1,
    },
  ];

  it("lists repos with their state and switches on click", async () => {
    render(Repos, { props: { repos, selected: "/w/api", busy: null } });
    expect(screen.getByText("↓2")).toBeTruthy();
    expect(screen.getByTitle("1 conflicted")).toBeTruthy();
    await fireEvent.click(screen.getByText("packages/ui"));
    expect(lastSent()).toEqual({ type: "selectRepo", root: "/w/ui" });
  });

  it("collapses to the current repo and flags others that need attention", async () => {
    render(Repos, { props: { repos, selected: "/w/api", busy: null } });
    await fireEvent.click(button(/Repositories/));
    expect(screen.queryByText("packages/ui")).toBeNull();
    expect(screen.getByTitle("1 other repo need attention")).toBeTruthy();
  });
});

describe("Undo timeline and saved changes", () => {
  const history = [
    { hash: "h2", before: "h1", time: 100, kind: "commit" as const, summary: 'Committed "two"' },
    {
      hash: "h1",
      before: "h0",
      time: 90,
      kind: "checkout" as const,
      summary: "Switched main → feat",
      from: "main",
      to: "feat",
    },
    { hash: "h0", before: null, time: 80, kind: "commit" as const, summary: 'Committed "old"' },
  ];

  it("undoes steps on this branch and greys out steps from another", async () => {
    render(History, { props: { repo: repoState({ history }), busy: null } });
    await fireEvent.click(button(/Undo/));
    const undo = screen.getAllByTitle(/Undo this|Go back/);
    expect(undo).toHaveLength(2);
    await fireEvent.click(undo[0]);
    expect(lastSent()).toEqual({ type: "action", request: { type: "undoTo", index: 0 } });
    expect(screen.getByText('Committed "old"').closest("li")!.classList.contains("elsewhere")).toBe(true);
  });

  it("restores, pops and deletes stashes", async () => {
    const stashes = [
      {
        ref: "stash@{0}",
        hash: "s0",
        time: Math.floor(Date.now() / 1000),
        branch: "main",
        message: "GitKit discard: a.txt",
        byGitKit: true,
      },
    ];
    render(Stashes, { props: { repo: repoState({ stashes }), busy: null } });
    expect(screen.getByText("your discard is here")).toBeTruthy();
    await fireEvent.click(button(/Saved changes/));
    expect(screen.getByText("Discarded: a.txt")).toBeTruthy();
    await fireEvent.click(screen.getByTitle(/Restore, keeping a copy/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "stashApply", ref: "stash@{0}" } });
    await fireEvent.click(screen.getByTitle(/Delete for good/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "stashDrop", ref: "stash@{0}" } });
  });
});

describe("Graph", () => {
  it("draws commits with lane-coloured branch chips and opens details on click", async () => {
    const repo = repoState({ unpushed: ["c2"] });
    render(Graph, { props: { repo, busy: null, details: null } });
    expect(screen.getByText("feat: add login")).toBeTruthy();
    expect(screen.getByText("main").closest(".ref")?.getAttribute("style")).toContain("--chip");
    await fireEvent.click(screen.getByText("feat: add login"));
    expect(lastSent()).toEqual({ type: "commitDetails", hash: "c2" });
    expect(screen.getByText("local")).toBeTruthy();
  });

  it("names merged branches whose refs are gone", () => {
    const commits = [
      commitOf("m", ["b", "f"], "Merge branch 'feat/ui'", { refs: [{ name: "main", kind: "local", isHead: true }] }),
      commitOf("f", ["a"], "style"),
      commitOf("b", ["a"], "docs"),
      commitOf("a", [], "init"),
    ];
    render(Graph, { props: { repo: repoState({ status: { oid: "m" }, commits }), busy: null, details: null } });
    expect(screen.getByTitle("feat/ui: merged, branch deleted")).toBeTruthy();
  });

  it("opens the Branch Map", async () => {
    render(Graph, { props: { repo: repoState(), busy: null, details: null } });
    await fireEvent.click(screen.getByTitle("Open the Branch Map"));
    expect(lastSent()).toEqual({ type: "openBranchMap" });
  });
});

describe("App", () => {
  const post = async (data: unknown) => {
    window.dispatchEvent(new MessageEvent("message", { data }));
    await tick();
  };

  it("asks the extension for state, then renders what it gets", async () => {
    render(App);
    expect(sent[0]).toEqual({ type: "ready" });
    await post({ type: "state", state: { kind: "no-folder" } });
    await fireEvent.click(button("Open Folder"));
    expect(lastSent()).toEqual({ type: "openFolder" });

    await post({ type: "state", state: { kind: "repo", repo: repoState({ status: { ahead: 1 } }), repos: [] } });
    expect(screen.getByText("1 commit ready to push")).toBeTruthy();
  });

  it("shows errors with the failed command, and a banner to finish a paused merge", async () => {
    render(App);
    const merging = repoState({ operation: "merge" });
    await post({ type: "state", state: { kind: "repo", repo: merging, repos: [] } });
    await post({ type: "error", error: { command: "git push", message: "rejected" } });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("rejected")).toBeTruthy();
    expect(within(alert).getByText("git push")).toBeTruthy();

    await fireEvent.click(button(/Continue/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "continueOperation" } });
  });

  it("applies the main-branch colour setting", async () => {
    render(App);
    await post({ type: "config", mainBranchColor: "green" });
    expect(document.documentElement.style.getPropertyValue("--gk-main-color")).toBe("var(--vscode-charts-green)");
  });
});
