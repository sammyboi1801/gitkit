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
}
