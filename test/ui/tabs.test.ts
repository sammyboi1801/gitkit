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
    expect(within(editor).getByRole("button", { name: /actions\/checkout@v5/ })).toBeTruthy();
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
    expect(steps()).toEqual(["1 actions/checkout@v5", "2 actions/setup-node@v5", "3 npm ci", "4 npm test"]);
    // The version matrix it had is kept.
    expect(within(editor).getByText(/kept as is: strategy/)).toBeTruthy();

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
    expect(yamlText()).toContain("uses: actions/setup-python@v6");
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
    await fireEvent.click(within(editor).getByRole("button", { name: /actions\/setup-node@v5/ }));
    await fireEvent.input(within(editor).getByRole("textbox", { name: "Value of cache" }), {
      target: { value: "pnpm" },
    });
    expect(lintSteps()[1]).toEqual({ uses: "actions/setup-node@v5", with: { "node-version": "lts/*", cache: "pnpm" } });
    await fireEvent.click(within(editor).getByRole("button", { name: "Remove input cache" }));
    expect(lintSteps()[1]).toEqual({ uses: "actions/setup-node@v5", with: { "node-version": "lts/*" } });
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
    expect(within(editor).getByText(/kept as is: environment/)).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "build", pressed: true })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(lastSent()).toMatchObject({ type: "save", model: { file: "docs.yml", rawOn: model.rawOn } });
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
