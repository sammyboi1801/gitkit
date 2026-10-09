import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { suggestWorkflow } from "../../src/workflow/model";
import { importWorkflow } from "../../src/workflow/import";
import { explain } from "../../src/workflow/yaml";
import Map from "../../webview/map/Map.svelte";
import Studio from "../../webview/workflow/Studio.svelte";
import { sent } from "./setup";
import type { CiStatus, RepoState, WorktreeInfo } from "../../src/shared/types";
import { commitOf, repoState } from "./state";

const post = async (data: unknown) => {
  window.dispatchEvent(new MessageEvent("message", { data }));
  await tick();
};
const lastSent = () => sent.at(-1);

describe("Branch Map", () => {
  const commits = [
    commitOf("x", ["b"], "feat: login form", { refs: [{ name: "feat/login", kind: "local", isHead: true }] }),
    commitOf("b", ["a"], "docs: readme", {
      refs: [{ name: "main", kind: "local", isHead: false }],
      author: "Alex Chen",
    }),
    commitOf("a", [], "init"),
  ];
  const onLogin = () => repoState({ status: { branch: "feat/login", oid: "x" }, commits });
  const open = async (repo = onLogin()) => {
    render(Map);
    await post({ type: "state", state: { kind: "repo", repo, repos: [] } });
  };
  /** A new state from the host, as after a fetch or a commit. */
  const update = (repo: RepoState) => post({ type: "state", state: { kind: "repo", repo, repos: [] } });
  const node = (subject: RegExp) => screen.getByRole("button", { name: subject });
  const flag = (branch: string) => document.querySelector(`[data-branch="${branch}"]`)!;
  const menuItem = (name: RegExp) => screen.getByRole("menuitem", { name });

  it("asks for state, then draws named lanes with commits you can open", async () => {
    await open();
    expect(sent[0]).toEqual({ type: "ready" });
    // main's lane is named under its first commit; feat/login's flag already names its lane.
    const labels = [...document.querySelectorAll(".lane-label")].map((t) => t.textContent?.trim());
    expect(labels).toEqual(["main"]);
    await fireEvent.click(node(/feat: login form/));
    expect(lastSent()).toEqual({ type: "commitDetails", hash: "x" });
  });

  describe("remote status", () => {
    const strip = () => screen.getByRole("region", { name: "Remote status" });
    const base = { ref: "origin/main", name: "main", ahead: 1, behind: 2, forkPoint: "b", isCurrent: false };

    it("shows how the branch stands against its remote copy, with the one action that fits", async () => {
      await open(
        repoState({
          status: { branch: "feat/login", oid: "x", upstream: "origin/feat/login", ahead: 2, behind: 1 },
          commits,
        }),
      );
      expect(within(strip()).getByText("origin/feat/login")).toBeTruthy();
      expect(within(strip()).getByText("2 to push")).toBeTruthy();
      expect(within(strip()).getByText("1 to pull")).toBeTruthy();
      const sync = within(strip()).getByRole("button", { name: /Sync/ });
      expect(sync.getAttribute("title")).toMatch(/^git pull --rebase/);
      await fireEvent.click(sync);
      expect(lastSent()).toEqual({ type: "action", request: { type: "sync" } });
    });

    it("says when everything is in sync, and offers to publish a branch that isn't on the remote", async () => {
      await open();
      expect(within(strip()).getByText("in sync")).toBeTruthy();
      expect(within(strip()).queryByRole("button", { name: /Push|Pull|Sync/ })).toBeNull();

      await update(repoState({ status: { branch: "feat/login", oid: "x", upstream: null }, commits }));
      expect(within(strip()).getByText("only on your machine")).toBeTruthy();
      await fireEvent.click(within(strip()).getByRole("button", { name: /Publish|Push/ }));
      expect(lastSent()).toEqual({ type: "action", request: { type: "push" } });
    });

    it("forecasts conflicts with main and offers to update from it", async () => {
      await open(
        repoState({ status: { branch: "feat/login", oid: "x" }, commits, base: { ...base, conflicts: ["app.ts"] } }),
      );
      expect(within(strip()).getByText("2 new since you branched")).toBeTruthy();
      expect(within(strip()).getByText(/would conflict in app\.ts/)).toBeTruthy();
      await fireEvent.click(within(strip()).getByRole("button", { name: /main/ }));
      expect(lastSent()).toEqual({ type: "action", request: { type: "updateFromBase" } });

      await update(
        repoState({ status: { branch: "feat/login", oid: "x" }, commits, base: { ...base, conflicts: [] } }),
      );
      expect(within(strip()).getByText("merges cleanly")).toBeTruthy();

      // Mid-merge, the forecast is about the conflict you're in, and updating again makes no sense.
      await update(
        repoState({
          status: { branch: "feat/login", oid: "x" },
          commits,
          operation: "merge",
          base: { ...base, conflicts: ["app.ts"] },
        }),
      );
      expect(within(strip()).queryByText(/would conflict/)).toBeNull();
      expect(within(strip()).getByText("merge in progress")).toBeTruthy();
      expect(within(strip()).queryByRole("button", { name: /main/ })).toBeNull();
    });

    it("shows CI for the last push and when the remote was last checked, with a way to check now", async () => {
      const ci: CiStatus = {
        state: "failure",
        sha: "x",
        summary: "1 of 3 checks failed",
        failed: ["test"],
        url: "https://ci",
        runId: 1,
        failures: [],
      };
      await open(repoState({ status: { branch: "feat/login", oid: "x" }, commits, ci }));
      expect(within(strip()).getByText("CI: 1 of 3 checks failed")).toBeTruthy();
      await fireEvent.click(within(strip()).getByRole("button", { name: "Open on GitHub" }));
      expect(lastSent()).toEqual({ type: "openUrl", url: "https://ci" });

      expect(within(strip()).getByText(/checked 2m ago/)).toBeTruthy();
      await fireEvent.click(within(strip()).getByRole("button", { name: "Check the remote for new commits" }));
      expect(lastSent()).toEqual({ type: "action", request: { type: "fetch" } });
      await post({ type: "fetching", active: true });
      expect(within(strip()).getByText(/checking…/)).toBeTruthy();
    });

    it("shows the branch's pull request, or a way to open one", async () => {
      const pr = {
        number: 42,
        title: "t",
        url: "https://github.com/octo/demo/pull/42",
        draft: false,
        base: "main",
        review: "approved" as const,
        unresolved: 0,
        mergeable: "clean" as const,
      };
      await open(
        repoState({ status: { branch: "feat/login", oid: "x" }, commits, pr: { kind: "open", pr, signedIn: true } }),
      );
      expect(within(strip()).getByRole("button", { name: "PR #42" })).toBeTruthy();
      expect(within(strip()).getByText(/^ready to merge/)).toBeTruthy();

      await update(
        repoState({
          status: { branch: "feat/login", oid: "x" },
          commits,
          pr: { kind: "none", head: "feat/login", base: "main" },
        }),
      );
      await fireEvent.click(within(strip()).getByRole("button", { name: "Open a PR" }));
      expect(lastSent()).toEqual({ type: "createPr" });
    });

    it("says when the remote couldn't be reached", async () => {
      await open(repoState({ status: { branch: "feat/login", oid: "x" }, commits, fetchError: "offline" }));
      expect(within(strip()).getByText(/couldn't reach the remote/)).toBeTruthy();
    });

    it("explains the dots and lines, and stays out of the way without a remote", async () => {
      await open();
      expect(screen.getByText("not pushed yet")).toBeTruthy();
      expect(screen.getByText("on the remote, not pulled yet")).toBeTruthy();

      await update(repoState({ status: { branch: "feat/login", oid: "x", upstream: null }, commits, remotes: [] }));
      expect(screen.queryByRole("region", { name: "Remote status" })).toBeNull();
    });
  });

  it("shortens branch names that would run into the next flag, with the full name on hover", async () => {
    const crowded = [
      commitOf("y", ["x"], "next", {
        refs: [{ name: "feature/a-very-long-branch-name", kind: "local", isHead: true }],
      }),
      commitOf("x", ["a"], "first", { refs: [{ name: "feature/another-long-name", kind: "local", isHead: false }] }),
      commitOf("a", [], "init", { refs: [{ name: "main", kind: "local", isHead: false }] }),
    ];
    await open(repoState({ status: { branch: "feature/a-very-long-branch-name", oid: "y" }, commits: crowded }));
    const label = flag("feature/another-long-name").querySelector("text")!.textContent!;
    expect(label.endsWith("…")).toBe(true);
    expect(flag("main").querySelector("text")!.textContent).toBe("main");

    await fireEvent.pointerEnter(flag("feature/another-long-name"));
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText("feature/another-long-name")).toBeTruthy();
    expect(within(tip).getByText(/Click for actions/)).toBeTruthy();
    await fireEvent.pointerLeave(flag("feature/another-long-name"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows on hover where the current branch stands against the remote", async () => {
    await open(
      repoState({ status: { branch: "feat/login", oid: "x", upstream: "origin/feat/login", ahead: 2 }, commits }),
    );
    await fireEvent.pointerEnter(flag("feat/login"));
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText(/Branch · you're on it/)).toBeTruthy();
    expect(within(tip).getByText("2 to push")).toBeTruthy();

    await fireEvent.pointerLeave(flag("feat/login"));
    await fireEvent.pointerEnter(flag("main"));
    expect(within(screen.getByRole("tooltip")).queryByText(/you're on it/)).toBeNull();
  });

  describe("worktrees", () => {
    const tree = (path: string, branch: string, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
      path,
      branch,
      head: "x",
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
      uncommitted: null,
      ...extra,
    });
    const worktrees = [
      tree("/repo", "feat/login", { main: true, current: true }),
      tree("/repo.worktrees/main", "main", { changes: 4 }),
    ];
    const withTrees = (worktreeOverlaps: RepoState["worktreeOverlaps"] = []) =>
      repoState({ status: { branch: "feat/login", oid: "x" }, commits, worktrees, worktreeOverlaps });

    it("badges branches open in another worktree, and opens it from the branch menu", async () => {
      await open(withTrees());
      expect(flag("main").querySelector("text")!.textContent).toBe("📂 main");
      expect(flag("feat/login").querySelector("text")!.textContent).toBe("feat/login");
      await fireEvent.pointerDown(flag("main"));
      await fireEvent.pointerUp(window);
      await fireEvent.click(menuItem(/Open its worktree/));
      expect(lastSent()).toEqual({ type: "openWorktree", path: "/repo.worktrees/main", newWindow: true });
    });

    it("says on hover where it's open, what's uncommitted there and what overlaps", async () => {
      await open(withTrees([{ a: "/repo", b: "/repo.worktrees/main", files: ["app.ts"], conflicts: null }]));
      await fireEvent.pointerEnter(flag("main"));
      const tip = within(screen.getByRole("tooltip"));
      expect(tip.getByText("Open in a worktree: /repo.worktrees/main")).toBeTruthy();
      expect(tip.getByText("4 uncommitted")).toBeTruthy();
      expect(tip.getByText("app.ts changed in main and feat/login")).toBeTruthy();
    });

    it("sums up overlapping worktrees in the strip, conflicts first", async () => {
      await open(withTrees([{ a: "/repo", b: "/repo.worktrees/main", files: ["app.ts"], conflicts: ["app.ts"] }]));
      expect(
        within(screen.getByRole("region", { name: "Remote status" })).getByText(
          /feat\/login and main would conflict in app\.ts/,
        ),
      ).toBeTruthy();
    });
  });

  describe("a branch with no commits yet", () => {
    const fresh = [
      commitOf("c", ["b"], "fix: bump version", { refs: [{ name: "origin/main", kind: "remote", isHead: false }] }),
      commitOf("b", ["a"], "feat: version endpoint"),
      commitOf("a", [], "feat: health endpoint", {
        refs: [
          { name: "testing-1", kind: "local", isHead: true },
          { name: "main", kind: "local", isHead: false },
        ],
      }),
    ];
    const ghost = () => screen.queryByRole("img", { name: /has no commits of its own yet/ });

    it("gets a dashed lane of its own that says where its first commit goes", async () => {
      await open(repoState({ status: { branch: "testing-1", oid: "a", upstream: null }, commits: fresh }));
      expect(ghost()?.getAttribute("aria-label")).toMatch(/^testing-1 has no commits/);
      expect(within(ghost()!).getByText("testing-1")).toBeTruthy();
      expect(within(ghost()!).getByText(/your next commit starts here/)).toBeTruthy();
    });

    it("goes away once the branch has its own commit, or on a branch with a lane", async () => {
      await open(repoState({ status: { branch: "testing-1", oid: "a", upstream: null }, commits: fresh }));
      await update(repoState({ status: { branch: "main", oid: "a" }, commits: fresh }));
      expect(ghost()).toBeNull();

      const committed = [
        commitOf("d", ["a"], "feat: my work", { refs: [{ name: "testing-1", kind: "local", isHead: true }] }),
        ...fresh,
      ];
      await update(repoState({ status: { branch: "testing-1", oid: "d", upstream: null }, commits: committed }));
      expect(ghost()).toBeNull();
    });

    it("isn't drawn for a detached HEAD", async () => {
      await open(repoState({ status: { branch: null, oid: "a" }, commits: fresh }));
      expect(ghost()).toBeNull();
    });
  });

  it("colours a remote branch's flag text, not just its outline", async () => {
    // The colour variable has to sit on the whole flag: set on the outline only, the text fell
    // back to black and origin/main was unreadable on dark themes.
    await open(
      repoState({
        status: { branch: "feat/login", oid: "x" },
        commits: [
          commitOf("x", ["b"], "feat: login form", { refs: [{ name: "feat/login", kind: "local", isHead: true }] }),
          commitOf("b", [], "docs: readme", {
            refs: [
              { name: "main", kind: "local", isHead: false },
              { name: "origin/main", kind: "remote", isHead: false },
            ],
          }),
        ],
      }),
    );
    const remote = document.querySelector(".flag-remote")!;
    expect(remote.getAttribute("style")).toMatch(/--chip:/);
    expect(flag("main").getAttribute("style")).toMatch(/--chip:/);
  });

  it("keeps hover tooltips next to the commit when the map is scrolled", async () => {
    await open();
    const hoverLeft = async () => {
      await fireEvent.pointerEnter(node(/feat: login form/));
      const left = screen.getByRole("tooltip").style.left;
      await fireEvent.pointerLeave(node(/feat: login form/));
      return left;
    };
    const before = await hoverLeft();
    // The tooltip sits inside the scrolling canvas, so it scrolls with the map by itself.
    const canvas = screen.getByRole("application");
    Object.defineProperty(canvas, "scrollLeft", { value: 500, configurable: true });
    Object.defineProperty(canvas, "scrollTop", { value: 40, configurable: true });
    expect(await hoverLeft()).toBe(before);
  });

  it("shows a commit's details on hover", async () => {
    await open(repoState({ status: { branch: "feat/login", oid: "x" }, commits, unpushed: ["x"] }));
    await fireEvent.pointerEnter(node(/feat: login form/));
    expect(screen.getByText("Not pushed yet")).toBeTruthy();
    expect(screen.getByText(/Right-click for actions/)).toBeTruthy();
  });

  it("shows who made each commit", async () => {
    await open();
    const initials = [...document.querySelectorAll(".initials")].map((t) => t.textContent);
    expect(initials).toEqual(expect.arrayContaining(["SS", "AC"]));
    expect(node(/docs: readme, b, by Alex Chen/)).toBeTruthy();
  });

  it("highlights one person's commits and fades the rest", async () => {
    await open();
    const team = screen.getByRole("group", { name: "Filter by author" });
    await fireEvent.click(within(team).getByRole("button", { name: /Alex Chen/ }));
    expect(node(/docs: readme/).classList.contains("dim")).toBe(false);
    expect(node(/feat: login form/).classList.contains("dim")).toBe(true);
  });

  it("finds commits by message", async () => {
    await open();
    await fireEvent.input(screen.getByRole("searchbox", { name: "Find commits" }), { target: { value: "login" } });
    expect(node(/feat: login form/).classList.contains("hit")).toBe(true);
    expect(node(/docs: readme/).classList.contains("dim")).toBe(true);
  });

  it("folds long quiet stretches into +N and opens them on click", async () => {
    const long = Array.from({ length: 40 }, (_, k) =>
      commitOf(`c${39 - k}`, k === 39 ? [] : [`c${38 - k}`], `commit ${39 - k}`, {
        refs: k === 0 ? [{ name: "main", kind: "local", isHead: true }] : [],
      }),
    );
    await open(repoState({ status: { oid: "c39" }, commits: long }));
    const group = screen.getByRole("button", { name: /38 more commits on main/ });
    await fireEvent.click(group);
    expect(screen.queryByRole("button", { name: /more commits/ })).toBeNull();
    expect(node(/commit 20,/)).toBeTruthy();
  });

  it("opens a branch's actions on click, with the exact command on hover", async () => {
    await open();
    await fireEvent.pointerDown(flag("main"), { clientX: 10, clientY: 10 });
    await fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    const merge = menuItem(/Merge main into feat\/login/);
    expect(merge.getAttribute("title")).toBe("git merge --autostash --no-edit main");
    await fireEvent.click(merge);
    expect(lastSent()).toEqual({ type: "action", request: { type: "mergeBranch", branch: "main" } });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("merges or rebases by dragging one branch onto another", async () => {
    await open();
    await fireEvent.pointerDown(flag("feat/login"), { clientX: 10, clientY: 10 });
    await fireEvent.pointerMove(window, { clientX: 60, clientY: 40 });
    await fireEvent.pointerEnter(flag("main"));
    await fireEvent.pointerUp(window, { clientX: 60, clientY: 40 });
    expect(screen.getByRole("menu", { name: "feat/login → main" })).toBeTruthy();
    await fireEvent.click(menuItem(/Rebase feat\/login onto main/));
    expect(lastSent()).toEqual({ type: "action", request: { type: "rebaseOnto", branch: "main" } });
  });

  it("offers commit actions on right-click", async () => {
    await open();
    await fireEvent.contextMenu(node(/docs: readme/));
    await fireEvent.click(menuItem(/Copy b/));
    expect(lastSent()).toEqual({ type: "copyHash", hash: "b" });
  });

  it("steps through commits with the arrow keys", async () => {
    await open();
    const canvas = screen.getByRole("application");
    await fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    expect(lastSent()).toEqual({ type: "commitDetails", hash: "x" });
    await fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    expect(lastSent()).toEqual({ type: "commitDetails", hash: "b" });
    await fireEvent.keyDown(canvas, { key: "Escape" });
  });

  describe("zoom and pan", () => {
    const svg = () => document.querySelector(".canvas svg")!;
    const width = () => Number(svg().getAttribute("width"));
    const level = () => screen.getByTitle(/Back to 100%/).textContent?.trim();
    const wheel = async (init: WheelEventInit) => {
      screen
        .getByRole("application")
        .dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }));
      await tick();
    };

    it("scales the whole picture, not just the spacing", async () => {
      await open();
      const viewBox = svg().getAttribute("viewBox");
      const before = width();
      await fireEvent.click(screen.getByTitle("Zoom in"));
      expect(width()).toBeGreaterThan(before);
      expect(svg().getAttribute("viewBox")).toBe(viewBox);
      expect(level()).toBe("125%");
    });

    it("zooms with the scroll wheel and trackpad pinch", async () => {
      await open();
      const before = width();
      await wheel({ deltaY: -200 });
      expect(width()).toBeGreaterThan(before);
      const zoomedIn = width();
      await wheel({ deltaY: 40, ctrlKey: true }); // pinch out
      expect(width()).toBeLessThan(zoomedIn);
    });

    it("lets sideways scrolling pan instead of zoom", async () => {
      await open();
      const before = width();
      await wheel({ deltaY: -200, shiftKey: true });
      await wheel({ deltaX: 120, deltaY: 5 });
      expect(width()).toBe(before);
    });

    it("zooms with + and -, fits with 0, and resets to 100% from the toolbar", async () => {
      await open();
      const canvas = screen.getByRole("application");
      await fireEvent.keyDown(canvas, { key: "+" });
      expect(level()).toBe("125%");
      await fireEvent.keyDown(canvas, { key: "-" });
      await fireEvent.keyDown(canvas, { key: "-" });
      expect(level()).toBe("80%");
      await fireEvent.click(screen.getByTitle(/Back to 100%/));
      expect(level()).toBe("100%");
    });

    it("pans when dragging empty space, but not when pressing a commit", async () => {
      await open();
      const canvas = screen.getByRole("application");
      await fireEvent.pointerDown(svg(), { button: 0, clientX: 100, clientY: 100 });
      expect(canvas.classList.contains("panning")).toBe(true);
      await fireEvent.pointerUp(window);
      expect(canvas.classList.contains("panning")).toBe(false);

      await fireEvent.pointerDown(node(/feat: login form/), { button: 0, clientX: 10, clientY: 10 });
      expect(canvas.classList.contains("panning")).toBe(false);
    });
  });

  it("explains when there's no repo", async () => {
    render(Map);
    await post({ type: "state", state: { kind: "no-folder" } });
    expect(screen.getByText(/Open a git repository/)).toBeTruthy();
  });
});

describe("Workflow Studio", () => {
  const facts = { files: ["package.json"], npmScripts: { lint: "eslint .", test: "vitest" }, defaultBranch: "main" };
  const init = {
    type: "init",
    repoName: "demo",
    facts,
    suggestion: suggestWorkflow(facts),
    files: [{ file: "release.yml", byGitKit: false, summary: "Release · manually from the Actions tab · 1 job" }],
  };
  const yamlText = () => document.querySelector(".yaml")?.textContent ?? "";
  const startWith = async (goal: RegExp) => {
    render(Studio);
    await post(init);
    await fireEvent.click(screen.getByRole("button", { name: goal }));
  };

  it("starts by asking what to automate, recommending what fits the project", async () => {
    render(Studio);
    expect(sent[0]).toEqual({ type: "ready" });
    await post(init);
    expect(screen.getByRole("heading", { name: "What do you want to automate?" })).toBeTruthy();
    const check = screen.getByRole("button", { name: /Check every push/ });
    expect(within(check).getByText("Recommended for this project")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Deploy a site to GitHub Pages/ })).toBeTruthy();
  });

  it("lists existing workflows in plain English and opens them", async () => {
    render(Studio);
    await post(init);
    await fireEvent.click(screen.getByRole("button", { name: /release\.yml/ }));
    expect(lastSent()).toEqual({ type: "open", file: "release.yml" });
  });

  it("describes when it runs as a sentence of editable chips", async () => {
    await startWith(/Check every push/);
    expect(screen.getByRole("button", { name: "on pushes to main" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "on pull requests" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "on pushes to main" }));
    await fireEvent.input(screen.getByPlaceholderText("every branch"), { target: { value: "main, dev" } });
    expect(screen.getByRole("button", { name: "on pushes to main, dev" })).toBeTruthy();
  });

  it("explains what's wrong instead of letting a broken workflow be saved", async () => {
    await startWith(/Check every push/);
    for (const name of [/Remove: on pushes/, /Remove: on pull requests/, /Remove: with a Run button/]) {
      await fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.getByText("Pick at least one trigger, or the workflow never runs.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/1 thing to fix/);
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(screen.getByRole("button", { name: /Add a trigger/ }));
    await fireEvent.click(screen.getByRole("button", { name: "On pull requests" }));
    expect(screen.getByRole("status").textContent).toMatch(/Ready to save/);
  });

  it("adds a job after another from a menu of plain-English choices", async () => {
    await startWith(/Check every push/);
    await fireEvent.click(screen.getByRole("button", { name: /Add a job after Lint/ }));
    const picker = screen.getByRole("group", { name: "Choose a job to add" });
    await fireEvent.click(within(picker).getByRole("button", { name: /Build \(Node\)/ }));
    const editor = screen.getByRole("dialog", { name: "Edit Build" });
    expect(within(editor).getByRole("button", { name: "Lint", pressed: true })).toBeTruthy();
  });

  it("edits a job with toggles instead of free text, and shows the YAML on demand", async () => {
    await startWith(/Check every push/);
    expect(document.querySelector(".yaml")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));

    await fireEvent.click(screen.getByRole("button", { name: /^Test\b.*npm test/ }));
    const editor = screen.getByRole("dialog", { name: "Edit Test" });
    // Defaults are 22 and 24; switching 24 off leaves one version.
    await fireEvent.click(within(editor).getByRole("button", { name: "24" }));
    await fireEvent.click(within(editor).getByRole("radio", { name: "Windows" }));
    expect(yamlText()).toContain('node-version: ["22"]');
    expect(yamlText()).toContain("runs-on: windows-latest");
  });

  it("saves under the chosen file name", async () => {
    await startWith(/Check every push/);
    await fireEvent.input(screen.getByRole("textbox", { name: "File name" }), { target: { value: "checks.yml" } });
    await fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    const saved = lastSent() as { type: string; model: { file: string; jobs: unknown[] } };
    expect(saved).toMatchObject({ type: "save", model: { file: "checks.yml" } });
    expect(saved.model.jobs).toHaveLength(2);
  });

  it("says which jobs get extra access, and that it's only those jobs", async () => {
    await startWith(/Publish a Docker image/);
    // Job cards are toggle buttons; "Add a job after…" is a plain one.
    await fireEvent.click(screen.getByRole("button", { name: /^Publish Docker image/, pressed: false }));
    expect(screen.getByText(/This job gets extra access: packages \(write\)/)).toBeTruthy();
  });

  it("lays jobs out left to right, with a way to add one that starts right away", async () => {
    await startWith(/Check every push/);
    expect(screen.queryByText("Runs first")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Add a job that starts right away" }));
    const picker = screen.getByRole("group", { name: "Choose a job to add" });
    await fireEvent.click(within(picker).getByRole("button", { name: /Your own steps/ }));
    const editor = screen.getByRole("dialog", { name: "Edit New job" });
    // It starts with the others, so it runs after nothing.
    expect(within(editor).queryByRole("button", { name: "Lint", pressed: true })).toBeNull();
    expect(within(editor).getByRole("button", { name: /actions\/checkout@v7/ })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: /Run a command/ })).toBeTruthy();
  });

  it("turns a ready-made job into its steps, which can be edited, reordered, added and removed", async () => {
    await startWith(/Check every push/);
    await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
    await fireEvent.click(screen.getByRole("button", { name: /^Test\b.*npm test/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Customize the steps/ }));
    const editor = screen.getByRole("dialog", { name: "Edit Test" });
    const steps = () =>
      within(editor)
        .getAllByRole("button", { expanded: false })
        .map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(steps()).toEqual(["1 actions/checkout@v7", "2 actions/setup-node@v7", "3 npm ci", "4 npm test"]);
    // The version matrix it had is kept, and editable as a "Run for each" variable.
    await fireEvent.click(within(editor).getByText("More options"));
    expect((within(editor).getByRole("textbox", { name: "Values of node-version" }) as HTMLInputElement).value).toBe(
      "22, 24",
    );

    await fireEvent.click(within(editor).getByRole("button", { name: /npm test/ }));
    await fireEvent.input(within(editor).getByRole("textbox", { name: /^Command/ }), {
      target: { value: "npm run test:ci" },
    });
    expect(yamlText()).toContain("- run: npm run test:ci");

    await fireEvent.click(within(editor).getByRole("button", { name: "Move step 4 up" }));
    const runs = (parse(yamlText()).jobs.test.steps as { run?: string }[]).map((s) => s.run).filter(Boolean);
    expect(runs).toEqual(["npm run test:ci", "npm ci"]);

    await fireEvent.click(within(editor).getByRole("button", { name: /Add a step/ }));
    await fireEvent.click(within(editor).getByRole("button", { name: "Set up Python" }));
    expect(yamlText()).toContain("uses: actions/setup-python@v7");
    await fireEvent.click(within(editor).getByRole("button", { name: "Remove step 5" }));
    expect(yamlText()).not.toContain("setup-python");
  });

  it("edits an action's inputs and switches a step between a command and an action", async () => {
    await startWith(/Check every push/);
    await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
    await fireEvent.click(screen.getByRole("button", { name: /^Lint\b/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Customize the steps/ }));
    const editor = screen.getByRole("dialog", { name: "Edit Lint" });
    const lintSteps = () => (parse(yamlText()).jobs.lint.steps as Record<string, unknown>[]).slice(0, 2);
    await fireEvent.click(within(editor).getByRole("button", { name: /actions\/setup-node@v7/ }));
    await fireEvent.input(within(editor).getByRole("textbox", { name: "Value of cache" }), {
      target: { value: "pnpm" },
    });
    expect(lintSteps()[1]).toEqual({ uses: "actions/setup-node@v7", with: { "node-version": "lts/*", cache: "pnpm" } });
    await fireEvent.click(within(editor).getByRole("button", { name: "Remove input cache" }));
    expect(lintSteps()[1]).toEqual({ uses: "actions/setup-node@v7", with: { "node-version": "lts/*" } });
    await fireEvent.click(within(editor).getByRole("radio", { name: "Command" }));
    await fireEvent.input(within(editor).getByRole("textbox", { name: /^Command/ }), { target: { value: "make" } });
    expect(lintSteps()[1]).toEqual({ run: "make" });
  });

  it("runs on a custom runner label", async () => {
    await startWith(/Check every push/);
    await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
    await fireEvent.click(screen.getByRole("button", { name: /^Lint\b/ }));
    await fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    await fireEvent.input(screen.getByRole("textbox", { name: "Runner label" }), {
      target: { value: "ubuntu-24.04-arm" },
    });
    expect(yamlText()).toContain("runs-on: ubuntu-24.04-arm");
  });

  it("picks a schedule from lists, with a custom cron for anything else", async () => {
    await startWith(/Check every push/);
    await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Add a trigger/ }));
    await fireEvent.click(screen.getByRole("button", { name: "On a schedule" }));
    await fireEvent.change(screen.getByRole("combobox", { name: /^How often/ }), { target: { value: "weekly" } });
    await fireEvent.change(screen.getByRole("combobox", { name: /^On\b/ }), { target: { value: "5" } });
    await fireEvent.change(screen.getByRole("combobox", { name: "Hour" }), { target: { value: "9" } });
    await fireEvent.change(screen.getByRole("combobox", { name: "Minute" }), { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "every Friday at 09:30 UTC" })).toBeTruthy();
    expect(yamlText()).toMatch(/cron: "?30 9 \* \* 5"?$/m);

    await fireEvent.change(screen.getByRole("combobox", { name: /^How often/ }), { target: { value: "custom" } });
    await fireEvent.input(screen.getByRole("textbox", { name: /Cron expression/ }), {
      target: { value: "0 9-17 * * 1-5" },
    });
    expect(yamlText()).toMatch(/cron: "?0 9-17 \* \* 1-5"?$/m);
  });

  it("opens hand-written workflows as editable jobs, keeping what it can't show", async () => {
    render(Studio);
    await post(init);
    await fireEvent.click(screen.getByRole("button", { name: /release\.yml/ }));
    const text = [
      "name: Docs",
      "on:",
      "  push:",
      "    paths: [docs/**]",
      "  release:",
      "    types: [published]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: make docs",
      "  deploy:",
      "    needs: build",
      "    runs-on: [self-hosted, linux]",
      "    environment: production",
      "    steps:",
      "      - run: ./deploy.sh",
    ].join("\n");
    const model = importWorkflow(text, "docs.yml");
    await post({ type: "opened", file: "docs.yml", model, imported: true, explanation: explain(text) });

    expect(screen.getByRole("note").textContent).toMatch(/but not its comments/);
    expect(screen.getByText("on push, release (kept as written)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a trigger/ })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: /^deploy\b/ }));
    const editor = screen.getByRole("dialog", { name: "Edit deploy" });
    expect(within(editor).getByText("self-hosted, linux")).toBeTruthy();
    expect((within(editor).getByPlaceholderText("production") as HTMLInputElement).value).toBe("production");
    expect(within(editor).getByRole("button", { name: "build", pressed: true })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(lastSent()).toMatchObject({ type: "save", model: { file: "docs.yml", rawOn: model.rawOn } });
  });

  describe("doing everything", () => {
    const yaml = () => parse(yamlText());
    /** Check every push, YAML shown, the given job's panel open (customized into steps if asked). */
    const editJob = async (name: RegExp, title: string, customize = false) => {
      await startWith(/Check every push/);
      await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
      await fireEvent.click(screen.getByRole("button", { name }));
      if (customize) await fireEvent.click(screen.getByRole("button", { name: /Customize the steps/ }));
      return screen.getByRole("dialog", { name: `Edit ${title}` });
    };
    const open = async (scope: HTMLElement, summary: string) => {
      const toggle = within(scope)
        .getAllByText(summary)
        .find((s) => !(s.parentElement as HTMLDetailsElement).open)!;
      await fireEvent.click(toggle);
    };

    it("finds ready-made steps by searching, and says what to do when there's none", async () => {
      const editor = await editJob(/^Test\b/, "Test", true);
      await fireEvent.click(within(editor).getByRole("button", { name: /Add a step/ }));
      const picker = within(screen.getByRole("group", { name: "Choose a step to add" }));
      expect(picker.getByRole("heading", { name: "Set up a language" })).toBeTruthy();
      await fireEvent.input(picker.getByRole("textbox", { name: "Search steps" }), {
        target: { value: "docker push" },
      });
      expect(picker.getByRole("button", { name: "Build and push an image" })).toBeTruthy();
      expect(picker.queryByRole("button", { name: "Set up Python" })).toBeNull();
      // The action's own name finds it too.
      await fireEvent.input(picker.getByRole("textbox", { name: "Search steps" }), { target: { value: "setup-java" } });
      expect(picker.getByRole("button", { name: "Set up Java" })).toBeTruthy();
      await fireEvent.input(picker.getByRole("textbox", { name: "Search steps" }), { target: { value: "terraform" } });
      expect(picker.getByText(/No ready-made step for "terraform"/)).toBeTruthy();
      await fireEvent.click(picker.getByRole("button", { name: "use an action" }));
      expect(yaml().jobs.test.steps.at(-1)).toEqual({});
    });

    it("gives a job the access a step needs, and says so", async () => {
      const editor = await editJob(/^Lint\b/, "Lint", true);
      await fireEvent.click(within(editor).getByRole("button", { name: /Add a step/ }));
      await fireEvent.click(within(editor).getByRole("button", { name: "Create a GitHub release" }));
      expect(within(editor).getByRole("status").textContent).toMatch(
        /That step needs contents \(write\): given to this job only\./,
      );
      expect(yaml().jobs.lint.permissions).toEqual({ contents: "write" });
      expect(yaml().permissions).toEqual({ contents: "read" });
    });

    it("sets a step's environment, shell, timeout and failure handling", async () => {
      const editor = await editJob(/^Test\b/, "Test", true);
      await fireEvent.click(within(editor).getByRole("button", { name: /npm test/ }));
      await open(editor, "More options");
      const options = within(editor.querySelector(".step-options") as HTMLElement);
      await fireEvent.click(options.getByRole("button", { name: /Add a variable/ }));
      await fireEvent.input(options.getByRole("textbox", { name: "Environment variables: name" }), {
        target: { value: "CI" },
      });
      await fireEvent.input(options.getByRole("textbox", { name: "Environment variables: value of CI" }), {
        target: { value: "true" },
      });
      await fireEvent.change(options.getByRole("combobox", { name: /Shell/ }), { target: { value: "bash" } });
      await fireEvent.input(options.getByRole("spinbutton", { name: /Stop after/ }), { target: { value: "5" } });
      await fireEvent.click(options.getByRole("checkbox", { name: /Keep going if this step fails/ }));
      expect(yaml().jobs.test.steps.at(-1)).toEqual({
        run: "npm test",
        env: { CI: true },
        shell: "bash",
        "timeout-minutes": 5,
        "continue-on-error": true,
      });
      // Clearing a field removes it again.
      await fireEvent.change(options.getByRole("combobox", { name: /Shell/ }), { target: { value: "" } });
      expect(yaml().jobs.test.steps.at(-1).shell).toBeUndefined();
    });

    it("sets a job's condition, services, matrix, permissions and timeout", async () => {
      const editor = await editJob(/^Lint\b/, "Lint", true);
      await fireEvent.change(within(editor).getByRole("combobox", { name: "When this job runs" }), {
        target: { value: "github.ref == 'refs/heads/main'" },
      });
      await open(editor, "More options");
      const options = within(editor.querySelector(".job-options") as HTMLElement);
      await fireEvent.click(options.getByRole("button", { name: /Add a database or other service/ }));
      await fireEvent.input(options.getByRole("textbox", { name: "Service name" }), { target: { value: "postgres" } });
      await fireEvent.input(options.getByRole("textbox", { name: "Image of postgres" }), {
        target: { value: "postgres:17" },
      });
      await fireEvent.input(options.getByRole("textbox", { name: "Ports of postgres" }), {
        target: { value: "5432:5432" },
      });
      await fireEvent.click(
        within(options.getByRole("group", { name: "Run for each" })).getByRole("button", { name: /Add a variable/ }),
      );
      await fireEvent.input(options.getByRole("textbox", { name: "Matrix variable" }), { target: { value: "os" } });
      await fireEvent.input(options.getByRole("textbox", { name: "Values of os" }), {
        target: { value: "ubuntu-latest, windows-latest" },
      });
      await fireEvent.change(options.getByRole("combobox", { name: "pull-requests permission" }), {
        target: { value: "write" },
      });
      await fireEvent.input(options.getByRole("spinbutton", { name: /Stop after/ }), { target: { value: "20" } });

      const lint = yaml().jobs.lint;
      expect(lint.if).toBe("github.ref == 'refs/heads/main'");
      expect(lint.services).toEqual({ postgres: { image: "postgres:17", ports: ["5432:5432"] } });
      expect(lint.strategy).toEqual({ matrix: { os: ["ubuntu-latest", "windows-latest"] } });
      expect(lint.permissions).toEqual({ "pull-requests": "write" });
      expect(lint["timeout-minutes"]).toBe(20);
    });

    it("picks when a job runs from a list, says it on the card, and takes any other condition", async () => {
      const editor = await editJob(/^Lint\b/, "Lint");
      const when = within(editor).getByRole("combobox", { name: "When this job runs" }) as HTMLSelectElement;
      expect(when.value).toBe("");
      await fireEvent.change(when, {
        target: { value: "github.event_name == 'push' && github.ref == 'refs/heads/main'" },
      });
      expect(yaml().jobs.lint.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
      expect(
        within(editor).getByText("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
      ).toBeTruthy();
      const card = screen.getByRole("button", { name: /^Lint\b/, pressed: true });
      expect(within(card).getByText("only on pushes to main")).toBeTruthy();

      await fireEvent.change(when, { target: { value: "custom" } });
      await fireEvent.input(within(editor).getByRole("textbox", { name: "Condition" }), {
        target: { value: "needs.changes.outputs.web == 'true'" },
      });
      expect(yaml().jobs.lint.if).toBe("needs.changes.outputs.web == 'true'");
      expect(within(card).getByText("if needs.changes.outputs.web == 'true'")).toBeTruthy();

      await fireEvent.change(when, { target: { value: "" } });
      expect(yaml().jobs.lint.if).toBeUndefined();
      expect(card.querySelector(".job-when")).toBeNull();
    });

    it("gives steps their own choices, like running a cleanup even after a failure", async () => {
      const editor = await editJob(/^Test\b/, "Test", true);
      await fireEvent.click(within(editor).getAllByRole("button", { name: /^\d+/ }).at(-1)!);
      await fireEvent.change(within(editor).getByRole("combobox", { name: "When this step runs" }), {
        target: { value: "always()" },
      });
      expect(yaml().jobs.test.steps.at(-1).if).toBe("always()");
    });

    it("warns, without blocking Save, when a deploy would run on every pull request, and fixes it", async () => {
      await startWith(/Check every push/);
      await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
      await fireEvent.click(screen.getByRole("button", { name: /Add a job after Lint/ }));
      const picker = screen.getByRole("group", { name: "Choose a job to add" });
      await fireEvent.click(within(picker).getByRole("button", { name: /Deploy to GitHub Pages/ }));

      const message = /also runs on pull requests, so every pull request would deploy\. Limit it to main\./;
      expect(screen.getAllByText(message).length).toBeGreaterThan(0);
      expect(document.querySelector("header .status")?.textContent).toMatch(/Ready to save · 1 warning/);
      expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false);

      await fireEvent.click(screen.getByRole("button", { name: "Only run on main" }));
      expect(screen.queryAllByText(message)).toEqual([]);
      expect(yaml().jobs["deploy-pages"].if).toBe("github.ref == 'refs/heads/main'");
      expect(document.querySelector("header .status")?.textContent).toMatch(/^\s*Ready to save\s*$/);
    });

    it("writes anything else into a job as YAML, and says what's wrong with invalid YAML", async () => {
      const editor = await editJob(/^Lint\b/, "Lint");
      await open(editor, "More options");
      await open(editor, "Job settings as YAML");
      const box = await within(editor).findByRole("textbox", { name: /^Everything set above/ });
      await fireEvent.input(box, { target: { value: "outputs: [oops" } });
      expect(within(editor).getByRole("alert").textContent).toMatch(/^Not applied yet:/);
      await fireEvent.input(box, {
        target: { value: "outputs:\n  version: ${{ steps.v.outputs.version }}\nenv:\n  A: '1'\n" },
      });
      expect(within(editor).queryByRole("alert")).toBeNull();
      expect(yaml().jobs.lint.outputs).toEqual({ version: "${{ steps.v.outputs.version }}" });
      // The fields follow what the YAML set.
      expect(
        (within(editor).getByRole("textbox", { name: "Environment variables: name" }) as HTMLInputElement).value,
      ).toBe("A");
    });

    it("sets workflow-wide variables and the run name", async () => {
      await startWith(/Check every push/);
      await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
      const settings = within(screen.getByRole("region", { name: "More settings" }));
      await fireEvent.click(settings.getByRole("button", { name: /Add a variable/ }));
      await fireEvent.input(settings.getByRole("textbox", { name: "Environment variables: name" }), {
        target: { value: "FORCE_COLOR" },
      });
      await fireEvent.input(settings.getByRole("textbox", { name: "Environment variables: value of FORCE_COLOR" }), {
        target: { value: "1" },
      });
      await fireEvent.input(settings.getByRole("textbox", { name: /Name of each run/ }), {
        target: { value: "CI for ${{ github.ref_name }}" },
      });
      expect(yaml().env).toEqual({ FORCE_COLOR: 1 });
      expect(yaml()["run-name"]).toBe("CI for ${{ github.ref_name }}");
      expect(Object.keys(yaml()).slice(0, 3)).toEqual(["name", "run-name", "on"]);
    });

    it("adds any other trigger as YAML from 'Add a trigger'", async () => {
      await startWith(/Check every push/);
      await fireEvent.click(screen.getByRole("button", { name: /Show YAML/ }));
      await fireEvent.click(screen.getByRole("button", { name: /Add a trigger/ }));
      await fireEvent.click(screen.getByRole("button", { name: /Something else/ }));
      const box = await screen.findByRole("textbox", { name: /^When it runs/ });
      await fireEvent.input(box, { target: { value: "release:\n  types: [published]\nworkflow_dispatch:\n" } });
      expect(screen.getByText("on release, workflow_dispatch (kept as written)")).toBeTruthy();
      expect(yaml().on).toEqual({ release: { types: ["published"] }, workflow_dispatch: null });
      // Back to something the chips can show: chips again.
      await fireEvent.input(box, { target: { value: "push:\n  branches: [main]\n" } });
      expect(screen.getByRole("button", { name: "on pushes to main" })).toBeTruthy();
    });

    it("always shows the schedule's cron, and lets you type one", async () => {
      await startWith(/Check every push/);
      await fireEvent.click(screen.getByRole("button", { name: /Add a trigger/ }));
      await fireEvent.click(screen.getByRole("button", { name: "On a schedule" }));
      const cron = screen.getByRole("textbox", { name: /Cron expression/ }) as HTMLInputElement;
      expect(cron.value).toMatch(/^\d+ \d+ /);
      await fireEvent.input(cron, { target: { value: "15 3 * * *" } });
      expect(screen.getByRole("button", { name: "every day at 03:15 UTC" })).toBeTruthy();
      expect(screen.getByText(/^every day at 03:15 UTC\. Fields: minute hour/)).toBeTruthy();
    });
  });

  it("shows files it can't read, with a way to open them and a way back", async () => {
    render(Studio);
    await post(init);
    const explanation = explain("name: [broken\n");
    await post({ type: "opened", file: "release.yml", model: null, imported: false, explanation });
    expect(screen.getByText(/isn't valid YAML/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /Open the file/ }));
    expect(lastSent()).toEqual({ type: "openFile", file: "release.yml" });
    await fireEvent.click(screen.getByRole("button", { name: /All workflows/ }));
    expect(screen.getByRole("heading", { name: "What do you want to automate?" })).toBeTruthy();
  });
});
