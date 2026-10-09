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
import Worktrees from "../../webview/pulse/Worktrees.svelte";
import type { Checkpoint, CiStatus, PullRequest, RepoState, WorktreeInfo } from "../../src/shared/types";
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

describe("Worktrees", () => {
  const tree = (overrides: Partial<WorktreeInfo>): WorktreeInfo => ({
    path: "/code/app.worktrees/x",
    head: "abcdef1234",
    branch: "x",
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
    ...overrides,
  });
  const trees = [
    tree({ path: "/code/app", branch: "main", main: true, current: true }),
    tree({
      path: "/code/app.worktrees/feature-login",
      branch: "feature/login",
      changes: 3,
      ahead: 2,
      behind: 1,
      lastActivity: Math.floor(Date.now() / 1000) - 120,
    }),
    tree({ path: "/elsewhere/agent", branch: null, head: "1234567890", locked: "agent session running" }),
    tree({ path: "/code/app.worktrees/gone", branch: "gone", prunable: "gitdir file points to non-existent location" }),
  ];
  const show = (worktrees = trees) =>
    render(Worktrees, { props: { repo: repoState({ worktrees, base: { ...baseInfo, name: "main" } }), busy: null } });
  const baseInfo = {
    ref: "origin/main",
    name: "main",
    ahead: 0,
    behind: 0,
    forkPoint: null,
    conflicts: null,
    isCurrent: true,
  };
  const rows = () => within(screen.getByRole("list", { name: "Worktrees" })).getAllByRole("listitem");

  it("lists every checkout with its branch, folder and what's going on in it", () => {
    show();
    const [main, feature, agent, gone] = rows();
    expect(within(main).getByText("this window")).toBeTruthy();
    expect(within(feature).getByText("feature/login")).toBeTruthy();
    expect(within(feature).getByText("app.worktrees/feature-login")).toBeTruthy();
    expect(within(feature).getByText("3 uncommitted")).toBeTruthy();
    expect(within(feature).getByText("↑2")).toBeTruthy();
    expect(within(feature).getByText("↓1 behind main")).toBeTruthy();
    expect(within(feature).getByText("2m ago")).toBeTruthy();
    expect(within(agent).getByText("detached at 1234567")).toBeTruthy();
    expect(within(agent).getByText("/elsewhere/agent")).toBeTruthy();
    expect(within(agent).getByTitle("Locked: agent session running")).toBeTruthy();
    expect(within(gone).getByText("folder is gone")).toBeTruthy();
  });

  it("opens a worktree in a new window on click, or adds it to this window", async () => {
    show();
    await fireEvent.click(within(rows()[1]).getByRole("button", { name: /^feature\/login/ }));
    expect(lastSent()).toEqual({ type: "openWorktree", path: "/code/app.worktrees/feature-login", newWindow: true });
    await fireEvent.click(button("Add feature/login to this window"));
    expect(lastSent()).toEqual({ type: "openWorktree", path: "/code/app.worktrees/feature-login", newWindow: false });
  });

  it("can't open this window's own worktree, or one whose folder is gone", () => {
    show();
    const [main, , , gone] = rows();
    expect((within(main).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect((within(gone).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(within(gone).queryByRole("button", { name: /to this window/ })).toBeNull();
  });

  it("creates, removes, locks and cleans up, showing the exact command on each button", async () => {
    show();
    await fireEvent.click(button("New worktree"));
    expect(lastSent()).toEqual({ type: "newWorktree" });

    const remove = button("Remove feature/login");
    expect(remove.getAttribute("title")).toBe(
      "Remove this worktree (its branch stays)\ngit worktree remove --force /code/app.worktrees/feature-login",
    );
    await fireEvent.click(remove);
    expect(lastSent()).toEqual({
      type: "action",
      request: { type: "removeWorktree", path: "/code/app.worktrees/feature-login" },
    });

    await fireEvent.click(button("Lock feature/login"));
    expect(lastSent()).toEqual({
      type: "action",
      request: { type: "lockWorktree", path: "/code/app.worktrees/feature-login" },
    });
    await fireEvent.click(button("Unlock detached at 1234567"));
    expect(lastSent()).toEqual({ type: "action", request: { type: "unlockWorktree", path: "/elsewhere/agent" } });

    const cleanUp = button("Clean up");
    expect(cleanUp.getAttribute("title")).toBe("Forget the 1 worktree whose folder is gone\ngit worktree prune");
    await fireEvent.click(cleanUp);
    expect(lastSent()).toEqual({ type: "action", request: { type: "pruneWorktrees" } });
  });

  it("can't remove a locked worktree, and says why", () => {
    show();
    const remove = button("Remove detached at 1234567") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.getAttribute("title")).toBe("It's locked (agent session running). Unlock it first.");
  });

  it("warns under a worktree when another changed the same files, and when they'd conflict", () => {
    render(Worktrees, {
      props: {
        repo: repoState({
          worktrees: trees,
          worktreeOverlaps: [
            {
              a: "/code/app.worktrees/feature-login",
              b: "/elsewhere/agent",
              files: ["auth.py", "api.py"],
              conflicts: ["auth.py"],
            },
            { a: "/code/app", b: "/code/app.worktrees/feature-login", files: ["README.md"], conflicts: null },
          ],
        }),
        busy: null,
      },
    });
    const [main, feature, agent] = rows();
    expect(within(feature).getByText("conflicts with detached at 1234567 in auth.py")).toBeTruthy();
    expect(within(feature).getByText("also changed in main: README.md")).toBeTruthy();
    expect(within(agent).getByText("conflicts with feature/login in auth.py")).toBeTruthy();
    expect(within(main).getByText("also changed in feature/login: README.md")).toBeTruthy();
  });

  it("offers Clean up only when a worktree's folder is gone", () => {
    show(trees.filter((w) => w.prunable === null));
    expect(screen.queryByRole("button", { name: "Clean up" })).toBeNull();
  });

  it("stays out of the way for a repo with just its own checkout", () => {
    show([]);
    expect(screen.queryByText("Worktrees")).toBeNull();
  });
});

describe("Remote card", () => {
  describe("pull request", () => {
    const pull: PullRequest = {
      number: 42,
      title: "feat: health endpoint",
      url: "https://github.com/octo/demo/pull/42",
      draft: false,
      base: "main",
      review: "required",
      unresolved: 2,
      mergeable: "clean",
    };
    const success: CiStatus = { state: "success", sha: "s", summary: "", failed: [], url: "", runId: null };
    const show = (pr: RepoState["pr"], ci: CiStatus | null = success) =>
      render(Remote, {
        props: {
          repo: repoState({ status: { branch: "feat/x", upstream: "origin/feat/x" }, pr, ci }),
          busy: null,
          fetching: false,
        },
      });
    const line = () => screen.getByRole("group", { name: /^Pull request/ });

    it("reads as one sentence: what's done and what's missing", async () => {
      show({ kind: "open", pr: pull, signedIn: true });
      const parts = [...line().querySelectorAll(".pr-part")].map((p) => p.textContent);
      expect(parts.join(" ")).toBe("CI passing, review needed, 2 unresolved comments, merges cleanly");
      expect(within(line()).getByRole("button", { name: "PR #42" })).toBeTruthy();
      expect(within(line()).queryByText(/ready to merge/)).toBeNull();
      await fireEvent.click(within(line()).getByRole("button", { name: "PR #42" }));
      expect(lastSent()).toEqual({ type: "openUrl", url: pull.url });
    });

    it("says when it's ready to merge", () => {
      show({ kind: "open", pr: { ...pull, review: "approved", unresolved: 0 }, signedIn: true });
      expect(within(line()).getByText(/^ready to merge/)).toBeTruthy();
      expect(line().classList.contains("ready")).toBe(true);
    });

    it("offers sign-in when GitHub hid the review comments", async () => {
      show({ kind: "open", pr: { ...pull, unresolved: null }, signedIn: false });
      await fireEvent.click(within(line()).getByRole("button", { name: /sign in for comments/ }));
      expect(lastSent()).toEqual({ type: "signInGitHub" });
    });

    it("offers to open one when the pushed branch has none", async () => {
      show({ kind: "none", head: "feat/x", base: "main" });
      expect(within(line()).getByText("No pull request into main yet")).toBeTruthy();
      await fireEvent.click(within(line()).getByRole("button", { name: "Open a PR" }));
      expect(lastSent()).toEqual({ type: "createPr" });
    });

    it("stays hidden when there's nothing to say", () => {
      show(null);
      expect(screen.queryByRole("group", { name: /^Pull request/ })).toBeNull();
    });
  });

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

  describe("checkpoints", () => {
    const now = Math.floor(Date.now() / 1000);
    const checkpoint = (reason: string, minutesAgo: number, worktree = "main"): Checkpoint => ({
      ref: `refs/gitkit/checkpoints/${worktree}/${(now - minutesAgo * 60) * 1000}`,
      hash: `c${minutesAgo}`,
      time: now - minutesAgo * 60,
      reason,
      worktree,
    });
    const open = async (repo: RepoState) => {
      render(History, { props: { repo, busy: null } });
      await fireEvent.click(button(/^Undo/));
    };

    it("saves one by hand from the Undo header", async () => {
      render(History, { props: { repo: repoState({ history }), busy: null } });
      await fireEvent.click(button("Save checkpoint"));
      expect(lastSent()).toEqual({ type: "checkpoint" });
    });

    it("lists this worktree's checkpoints and restores one, showing the command", async () => {
      await open(
        repoState({ history, checkpoints: [checkpoint("before claude", 3), checkpoint("saved by hand", 40)] }),
      );
      const list = within(screen.getByRole("list", { name: "Checkpoints" }));
      expect(list.getAllByRole("listitem").map((li) => li.querySelector(".step-text")?.textContent)).toEqual([
        "before claude",
        "saved by hand",
      ]);
      expect(list.getByText("3m ago")).toBeTruthy();
      const restore = list.getByRole("button", { name: "Restore the checkpoint before claude" });
      expect(restore.getAttribute("title")).toBe(
        "Bring the files back to this checkpoint\ngit restore --source c3 --worktree -- .",
      );
      await fireEvent.click(restore);
      expect(lastSent()).toEqual({ type: "action", request: { type: "restoreCheckpoint", hash: "c3" } });
    });

    it("shows the five newest and says how many older ones there are", async () => {
      await open(repoState({ history, checkpoints: [1, 2, 3, 4, 5, 6, 7].map((m) => checkpoint(`edit ${m}`, m)) }));
      expect(within(screen.getByRole("list", { name: "Checkpoints" })).getAllByRole("listitem")).toHaveLength(5);
      expect(screen.getByText("and 2 older")).toBeTruthy();
    });

    it("recovers a removed worktree's checkpoint as a branch", async () => {
      const removed = checkpoint("before removing the worktree", 5, "agent");
      await open(repoState({ history: [], removedCheckpoints: [removed] }));
      const list = within(screen.getByRole("list", { name: "Checkpoints from removed worktrees" }));
      expect(list.getByText("agent: before removing the worktree")).toBeTruthy();
      await fireEvent.click(list.getByRole("button", { name: "Recover agent as a branch" }));
      const sent = lastSent() as { request: { type: string; name: string; hash: string } };
      expect(sent.request).toMatchObject({ type: "recoverBranch", hash: "c5" });
      expect(sent.request.name).toMatch(/^checkpoint\/agent-\d{8}-\d{4}$/);
    });
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
