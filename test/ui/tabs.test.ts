import { fireEvent, render, screen } from "@testing-library/svelte";
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

  it("draws one lane per branch, named, with commits you can open", async () => {
    render(Map);
    expect(sent[0]).toEqual({ type: "ready" });
    await post({
      type: "state",
      state: { kind: "repo", repo: repoState({ status: { branch: "feat/login", oid: "x" }, commits }), repos: [] },
    });

    const lanes = [...document.querySelectorAll(".lane-label text")].map((t) => t.textContent?.trim());
    expect(lanes).toEqual(expect.arrayContaining(["main", "feat/login"]));
    const node = screen.getByRole("button", { name: /feat: login form/ });
    await fireEvent.click(node);
    expect(lastSent()).toEqual({ type: "commitDetails", hash: "x" });
  });

  it("zooms in and out", async () => {
    render(Map);
    await post({ type: "state", state: { kind: "repo", repo: repoState({ commits }), repos: [] } });
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
