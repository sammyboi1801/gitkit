import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import { suggestWorkflow } from "../../src/workflow/model";
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

  it("zooms in and out", async () => {
    await open();
    const width = () => Number(document.querySelector(".canvas svg")?.getAttribute("width"));
    const before = width();
    await fireEvent.click(screen.getByTitle("Zoom in"));
    expect(width()).toBeGreaterThan(before);
  });

  it("explains when there's no repo", async () => {
    render(Map);
    await post({ type: "state", state: { kind: "no-folder" } });
    expect(screen.getByText(/Open a git repository/)).toBeTruthy();
  });
});

describe("Workflow Studio", () => {
  const suggestion = suggestWorkflow({ files: ["package.json"], npmScripts: { lint: "eslint .", test: "vitest" } });
  const init = { type: "init", repoName: "demo", suggestion, files: [{ file: "release.yml", byGitKit: false }] };

  it("starts from the suggestion and previews the YAML live", async () => {
    render(Studio);
    expect(sent[0]).toEqual({ type: "ready" });
    await post(init);
    expect(screen.getByDisplayValue("CI")).toBeTruthy();
    expect(document.querySelector(".yaml")?.textContent).toContain("npm run lint");

    await fireEvent.input(screen.getByDisplayValue("CI"), { target: { value: "Checks" } });
    expect(document.querySelector(".yaml")?.textContent).toContain("name: Checks");
  });

  it("blocks saving while there are problems, and saves the model when fixed", async () => {
    render(Studio);
    await post(init);
    for (const trash of screen.getAllByTitle("Remove job")) await fireEvent.click(trash);
    expect(screen.getByText("Add at least one job.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save ci\.yml/ }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(screen.getByRole("button", { name: /Add job/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Save ci\.yml/ }));
    const saved = lastSent() as { type: string; model: { jobs: unknown[] } };
    expect(saved.type).toBe("save");
    expect(saved.model.jobs).toHaveLength(1);
  });

  it("shows hand-written workflows in plain English", async () => {
    render(Studio);
    await post(init);
    const explanation = explain(
      "name: Release\non: workflow_dispatch\njobs:\n  go:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n",
    );
    await post({ type: "opened", file: "release.yml", model: null, editedByHand: false, explanation });
    expect(screen.getByText(/runs manually from the Actions tab/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /Open the file/ }));
    expect(lastSent()).toEqual({ type: "openFile", file: "release.yml" });
  });
});
