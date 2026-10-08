// Data shapes shared by the git layer, the extension host and the webviews. No runtime code here.

export interface FileChange {
  path: string;
  /** Previous path, for renames and copies. */
  origPath?: string;
  /** Status letter in the index (staged side), or null if unchanged there. */
  index: string | null;
  /** Status letter in the working tree, or null if unchanged there. */
  worktree: string | null;
  untracked: boolean;
  conflicted: boolean;
  /** Line counts for the staged side, from `git diff --cached --numstat`. */
  indexStats?: LineStats;
  /** Line counts for the working-tree side, from `git diff --numstat`. */
  worktreeStats?: LineStats;
}

export interface LineStats {
  added: number;
  removed: number;
  binary: boolean;
}

export interface Branch {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** The upstream was deleted on the remote, e.g. after a PR merge. */
  gone: boolean;
  current: boolean;
  /** Unix seconds of the tip commit. */
  time: number;
  subject: string;
}

export interface CommitFile {
  path: string;
  stats: LineStats;
}

export interface CommitDetails {
  hash: string;
  author: string;
  email: string;
  time: number;
  body: string;
  files: CommitFile[];
}

export interface StatusInfo {
  /** Null when HEAD is detached. */
  branch: string | null;
  /** Null before the first commit. */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}

export interface Ref {
  name: string;
  kind: "local" | "remote" | "tag";
  isHead: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  /** Unix seconds. */
  time: number;
  subject: string;
  refs: Ref[];
}

/** A branch's lane in the branch graph. */
export interface Lane {
  name: string;
  /** base: the main branch. merged: a branch known only from its merge commit. other: detached or tag-only. */
  kind: "base" | "branch" | "merged" | "other";
  /** Visual row (horizontal map) or column (sidebar); lanes that never overlap in time share one. */
  row: number;
  /** Palette index; 0 is reserved for the main branch. */
  color: number;
}

export interface GraphEdge {
  /** Indexes into BranchGraph.commits. */
  child: number;
  parent: number;
  /** line: along one lane. fork: a lane's first commit, off its parent lane. merge: a merge's extra parent. */
  kind: "line" | "fork" | "merge";
}

export interface BranchGraph {
  /** Newest first (topological). */
  commits: Commit[];
  lanes: Lane[];
  /** Per commit: its lane and its time column (0 = oldest). */
  placement: { lane: number; column: number }[];
  edges: GraphEdge[];
  rows: number;
}

export interface RepoState {
  root: string;
  status: StatusInfo;
  remotes: string[];
  stashes: StashEntry[];
  /** What happened to HEAD recently, newest first: the undo timeline. */
  history: HistoryEntry[];
  graph: BranchGraph;
  /** Commits on HEAD that aren't on any remote yet. */
  unpushed: string[];
  /** Commits on the upstream that HEAD doesn't have yet. */
  incoming: string[];
  /** The branch work usually merges into (origin/main or similar), compared with HEAD. */
  base: BaseInfo | null;
  /** Unix seconds of the last fetch, from FETCH_HEAD; null if never fetched. */
  lastFetch: number | null;
  /** Set by the extension when a background fetch fails, e.g. offline. */
  fetchError?: string;
  /** A merge, rebase, cherry-pick or revert that stopped part-way, usually on conflicts. */
  operation: Operation | null;
  activity: ActivityItem[];
  /** Set by the extension: GitHub checks for the latest pushed commit; null/undefined hides the row. */
  ci?: CiStatus | null;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

/** GitHub checks for the latest pushed commit of the current branch. */
export interface CiStatus {
  /** signin: a private repo, or rate-limited, and the user isn't signed in. */
  state: "success" | "failure" | "pending" | "none" | "signin" | "error";
  sha: string;
  summary: string;
  /** Names of failed checks. */
  failed: string[];
  url: string;
  /** The Actions run behind the first failure, for re-running failed jobs. */
  runId: number | null;
}

/** One thing that happened to HEAD, from the reflog, in plain English. */
export interface HistoryEntry {
  /** Where HEAD pointed after this happened. */
  hash: string;
  /** Where HEAD pointed just before, i.e. what undoing this goes back to. */
  before: string | null;
  time: number;
  kind: "commit" | "amend" | "checkout" | "merge" | "pull" | "rebase" | "reset" | "cherry-pick" | "revert" | "other";
  summary: string;
  /** For checkouts: the branch (or commit) left and the one entered. */
  from?: string;
  to?: string;
}

export interface StashEntry {
  /** e.g. "stash@{0}". */
  ref: string;
  hash: string;
  time: number;
  branch: string | null;
  message: string;
  /** Saved by GitKit's discard, so it's probably something the user wants back. */
  byGitKit: boolean;
}

/** One conflicted region of a file, between git's <<<<<<< and >>>>>>> markers. */
export interface ConflictBlock {
  index: number;
  /** 1-based line of the <<<<<<< marker. */
  line: number;
  /** Text after the markers, e.g. "HEAD" and "feat/label". */
  oursLabel: string;
  theirsLabel: string;
  ours: string[];
  /** The common ancestor's version, present only with diff3-style markers. */
  base: string[] | null;
  theirs: string[];
}

/** The cheap per-repo overview shown in the repository list when a workspace has several repos. */
export interface RepoSummary {
  root: string;
  label: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: number;
  conflicts: number;
  /** Set when the repo couldn't be read, e.g. a broken .git. */
  error?: string;
}

export interface BaseInfo {
  /** e.g. "origin/main". */
  ref: string;
  /** e.g. "main". */
  name: string;
  /** Commits on HEAD that the base doesn't have. */
  ahead: number;
  /** Commits on the base since HEAD branched off. */
  behind: number;
  /** Where HEAD branched off the base. */
  forkPoint: string | null;
  /** Files a merge would conflict in; null when not checked (nothing to merge). */
  conflicts: string[] | null;
  /** HEAD is the base branch itself (e.g. on main tracking origin/main). */
  isCurrent: boolean;
}

export interface ActivityItem {
  /** e.g. "origin/main". */
  ref: string;
  /** Unix seconds when the update arrived locally (fetch) or was sent (push). */
  time: number;
  kind: "push" | "fetch" | "forced" | "created";
  /** The update came from this machine pushing, not from someone else via fetch. */
  byYou: boolean;
  commits: number;
  authors: string[];
}
