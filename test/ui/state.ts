import type { Commit, FileChange, RepoState, StatusInfo } from "../../src/shared/types";
import { layoutBranches } from "../../src/git/lanes";

// Builders for the data the webviews render, so component tests read like scenarios.

export function file(path: string, change: Partial<FileChange> = {}): FileChange {
  return { path, index: null, worktree: "M", untracked: false, conflicted: false, ...change };
}

export function commitOf(hash: string, parents: string[], subject = hash, extra: Partial<Commit> = {}): Commit {
  return {
    hash,
    parents,
    author: "Sam Selvaraj",
    time: Math.floor(Date.now() / 1000) - 3600,
    subject,
    refs: [],
    ...extra,
  };
}

export function repoState(
  overrides: Omit<Partial<RepoState>, "status"> & { status?: Partial<StatusInfo>; commits?: Commit[] } = {},
): RepoState {
  const { status, commits: given, ...rest } = overrides;
  const commits = given ?? [
    commitOf("c2", ["c1"], "feat: add login", { refs: [{ name: "main", kind: "local", isHead: true }] }),
    commitOf("c1", [], "chore: initial commit", { author: "Alex Chen" }),
  ];
  return {
    root: "/repo",
    status: { branch: "main", oid: "c2", upstream: "origin/main", ahead: 0, behind: 0, files: [], ...status },
    remotes: ["origin"],
    stashes: [],
    history: [],
    graph: layoutBranches(commits, { base: "main", head: "main" }),
    unpushed: [],
    incoming: [],
    base: null,
    lastFetch: Math.floor(Date.now() / 1000) - 120,
    operation: null,
    activity: [],
    worktrees: [],
    checkpoints: [],
    removedCheckpoints: [],
    ...rest,
  };
}
