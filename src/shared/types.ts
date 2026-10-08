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

/** One segment of the graph drawn inside a row. y: 0 = row top, 1 = node centre, 2 = row bottom. */
export interface GraphLine {
  x1: number;
  y1: 0 | 1;
  x2: number;
  y2: 1 | 2;
  /** Lane index, used to pick the colour. */
  lane: number;
}

export interface GraphRow {
  commit: Commit;
  lane: number;
  lines: GraphLine[];
}

export interface RepoState {
  root: string;
  status: StatusInfo;
  remotes: string[];
  stashCount: number;
  rows: GraphRow[];
  lanes: number;
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
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

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
