import { describe, expect, it } from "vitest";
import { layoutBranches } from "../../src/git/lanes";
import type { RepoState } from "../../src/shared/types";
import { laneColor, laneStarts, laneTips, refColor } from "../../webview/shared/graph";
import {
  ago,
  badge,
  headAncestors,
  preview,
  relativeTime,
  splitPath,
  summarize,
  worktreeLabel,
  totals,
} from "../../webview/pulse/util";

const now = 1_800_000_000_000;

const repo = (status: Partial<RepoState["status"]> = {}, extra: Partial<RepoState> = {}): RepoState => ({
  root: "/r",
  status: { branch: "main", oid: "c", upstream: "origin/main", ahead: 0, behind: 0, files: [], ...status },
  remotes: ["origin"],
  stashes: [],
  history: [],
  graph: { commits: [], lanes: [], placement: [], edges: [], rows: 0 },
  unpushed: [],
  incoming: [],
  base: null,
  lastFetch: null,
  operation: null,
  activity: [],
  worktrees: [],
  checkpoints: [],
  removedCheckpoints: [],
  ...extra,
});

describe("summarize: the one-sentence status", () => {
  it.each([
    [repo(), "Clean and up to date"],
    [repo({ ahead: 1 }), "1 commit ready to push"],
    [repo({ behind: 3 }), "3 new commits on the remote"],
    [repo({ ahead: 2, behind: 1 }), "Diverged: 2 to push, 1 to pull. Sync replays yours on top"],
    [repo({ upstream: null }), "Not on the remote yet. Publish to share it"],
    [repo({ branch: null }), "Detached HEAD: create a branch to keep work"],
    [repo({}, { remotes: [] }), "No remote configured"],
    [
      repo({ files: [{ path: "a", index: "U", worktree: "U", untracked: false, conflicted: true }] }),
      "1 conflict to resolve",
    ],
    [repo({}, { operation: "rebase" }), "Rebase in progress: continue when ready"],
  ])("%#: %s", (state, text) => {
    expect(summarize(state).text).toBe(text);
  });
});

describe("small helpers", () => {
  it("previews commands or explains why an action can't run", () => {
    expect(preview({ type: "push" }, repo())).toEqual({ ok: true, text: "git push", label: "Push" });
    expect(preview({ type: "push" }, repo({}, { remotes: [] })).ok).toBe(true); // upstream set
    expect(preview({ type: "pull" }, repo({ upstream: null }))).toMatchObject({ ok: false });
  });

  it("formats times and paths", () => {
    expect(relativeTime(now / 1000 - 30, now)).toBe("now");
    expect(relativeTime(now / 1000 - 5 * 60, now)).toBe("5m");
    expect(relativeTime(now / 1000 - 3 * 86400, now)).toBe("3d");
    expect(ago(now / 1000 - 7200, now)).toBe("2h ago");
    expect(ago(now / 1000, now)).toBe("just now");
    expect(splitPath("src/git/repo.ts")).toEqual({ name: "repo.ts", dir: "src/git" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", dir: "" });
  });

  it("badges files like VS Code does", () => {
    expect(badge(null, true)).toEqual({ text: "U", tone: "untracked" });
    expect(badge("A", false)).toEqual({ text: "A", tone: "added" });
    expect(badge("U", false)).toEqual({ text: "!", tone: "conflict" });
  });

  it("totals line counts and finds commits reachable from HEAD", () => {
    expect(totals([{ added: 2, removed: 1 }, undefined, { added: 3, removed: 0 }])).toEqual({ added: 5, removed: 1 });
    const commits = [
      { hash: "c", parents: ["b"], author: "", time: 0, subject: "", refs: [] },
      { hash: "x", parents: ["a"], author: "", time: 0, subject: "", refs: [] },
      { hash: "b", parents: ["a"], author: "", time: 0, subject: "", refs: [] },
      { hash: "a", parents: [], author: "", time: 0, subject: "", refs: [] },
    ];
    const state = repo({ oid: "c" }, { graph: { commits, lanes: [], placement: [], edges: [], rows: 0 } });
    expect([...headAncestors(state)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("graph helpers", () => {
  const graph = layoutBranches(
    [
      {
        hash: "x",
        parents: ["b"],
        author: "",
        time: 0,
        subject: "",
        refs: [{ name: "feat", kind: "local", isHead: true }],
      },
      {
        hash: "b",
        parents: ["a"],
        author: "",
        time: 0,
        subject: "",
        refs: [{ name: "origin/main", kind: "remote", isHead: false }],
      },
      {
        hash: "a",
        parents: [],
        author: "",
        time: 0,
        subject: "",
        refs: [{ name: "main", kind: "local", isHead: false }],
      },
    ],
    { base: "main", head: "feat" },
  );

  it("colours a branch's chips like its lane, main with the configurable colour", () => {
    expect(laneColor(0)).toContain("--gk-main-color");
    expect(refColor(graph, { name: "origin/main", kind: "remote", isHead: false })).toBe(laneColor(0));
    expect(refColor(graph, { name: "feat", kind: "local", isHead: true })).toBe(laneColor(1));
    expect(refColor(graph, { name: "v1", kind: "tag", isHead: false })).toBeUndefined();
  });

  it("finds each lane's newest and oldest commit", () => {
    const main = graph.lanes.findIndex((l) => l.name === "main");
    expect(laneTips(graph).get(main)).toBe(1);
    expect(laneStarts(graph).get(main)).toBe(2);
  });
});

describe("worktreeLabel", () => {
  it.each([
    ["/code/app.worktrees/feature-login", "/code/app", "app.worktrees/feature-login"],
    ["C:\\Code\\app.worktrees\\x", "c:\\code\\app", "app.worktrees/x"],
    ["/code/app/.worktrees/x", "/code/app", "app/.worktrees/x"],
    ["/elsewhere/agent-1", "/code/app", "/elsewhere/agent-1"],
    ["/code/application", "/code/app", "application"],
  ])("%s next to %s → %s", (path, main, label) => {
    expect(worktreeLabel(path, main)).toBe(label);
  });
});
