import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type {
  ActivityItem,
  BaseInfo,
  Branch,
  CommitDetails,
  Operation,
  RepoState,
  RepoSummary,
  StatusInfo,
  WorktreeInfo,
  WorktreeOverlap,
} from "../shared/types";
import { BRANCH_FORMAT, parseBranches } from "./branches";
import { pathKey } from "./discover";
import { readCheckpointState } from "./checkpoints";
import { findOverlaps, readWorktreeInfo } from "./worktrees";
import { layoutBranches } from "./lanes";
import { LOG_FORMAT, parseLog } from "./log";
import { REFLOG_FORMAT, STASH_FORMAT, parseHistory, parseStashes } from "./history";
import { parseNumstat, toStatsMap } from "./numstat";
import { activityKind, parseMergeTree, parseReflog, pickBaseRef } from "./remote";
import { GitError, runGit } from "./runner";
import { parseStatus } from "./status";

const GRAPH_LIMIT = 200;
const HISTORY_LIMIT = 40;

/** Returns the repo root for a folder, or null if the folder isn't inside a git repo. */
export async function findRepoRoot(folder: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], folder);
    return stdout.trim();
  } catch (error) {
    if (error instanceof GitError && /not a git repository/i.test(error.stderr)) return null;
    throw error;
  }
}

/**
 * The repo a workspace folder belongs to. A parent repo that ignores the folder doesn't count:
 * e.g. ~/projects inside a dotfiles repo is not part of that repo in any useful sense.
 */
export async function findWorkspaceRepo(folder: string): Promise<string | null> {
  const root = await findRepoRoot(folder);
  if (!root || pathKey(root) === pathKey(folder)) return root;
  try {
    await runGit(["check-ignore", "-q", "--", folder], root);
    return null; // Exit 0: the folder is ignored by the parent repo.
  } catch {
    return root; // Exit 1: not ignored.
  }
}

// --no-optional-locks everywhere: reads would otherwise refresh the index, which trips our own file watcher.
const read = (args: string[], root: string) => runGit(["--no-optional-locks", ...args], root);
const lines = (text: string) => text.split("\n").filter(Boolean);

export async function readRepo(root: string): Promise<RepoState> {
  const [statusOut, remotesOut, stashOut, unstagedOut, stagedOut] = await Promise.all([
    read(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], root),
    read(["remote"], root),
    read(["stash", "list", `--format=${STASH_FORMAT}`], root),
    read(["diff", "--numstat", "-z", "--no-renames"], root),
    read(["diff", "--cached", "--numstat", "-z", "--no-renames"], root).catch(() => ({ stdout: "" })),
  ]);
  const status = parseStatus(statusOut.stdout);

  const unstagedStats = toStatsMap(parseNumstat(unstagedOut.stdout));
  const stagedStats = toStatsMap(parseNumstat(stagedOut.stdout));
  for (const file of status.files) {
    file.indexStats = stagedStats.get(file.path);
    file.worktreeStats = unstagedStats.get(file.path);
  }

  let commits: ReturnType<typeof parseLog> = [];
  let unpushed: string[] = [];
  let incoming: string[] = [];
  if (status.oid) {
    const [logOut, unpushedOut, incomingOut] = await Promise.all([
      read(
        [
          "log",
          "--branches",
          "--remotes",
          "--tags",
          "HEAD",
          "--topo-order",
          "--decorate=full",
          `--max-count=${GRAPH_LIMIT}`,
          `--format=${LOG_FORMAT}`,
        ],
        root,
      ),
      read(["rev-list", "HEAD", "--not", "--remotes", `--max-count=${GRAPH_LIMIT}`], root),
      status.upstream
        ? read(["rev-list", "HEAD..@{upstream}", `--max-count=${GRAPH_LIMIT}`], root)
        : Promise.resolve({ stdout: "" }),
    ]);
    commits = parseLog(logOut.stdout);
    unpushed = lines(unpushedOut.stdout);
    incoming = lines(incomingOut.stdout);
  }

  const history = status.oid
    ? parseHistory(
        (
          await read(
            ["reflog", "show", "--date=unix", `--format=${REFLOG_FORMAT}`, `-n${HISTORY_LIMIT}`, "HEAD"],
            root,
          ).catch(() => ({ stdout: "" }))
        ).stdout,
      )
    : [];

  const remotes = lines(remotesOut.stdout);
  const [paths, refsOut] = await Promise.all([
    read(["rev-parse", ...GIT_PATHS.flatMap((name) => ["--git-path", name])], root),
    read(["for-each-ref", "--format=%(refname)%1f%(objectname)", "refs/remotes", "refs/heads"], root),
  ]);
  const gitPaths = Object.fromEntries(
    lines(paths.stdout).map((value, i) => [GIT_PATHS[i], isAbsolute(value) ? value : join(root, value)]),
  );
  const refLines = lines(refsOut.stdout);
  // Full ref names, so a local "feat/x" can't be mistaken for a remote "origin/x".
  const refNames = refLines.map((line) => shortRef(line.split("\x1f")[0]));

  const [base, activity] = await Promise.all([
    status.oid ? readBase(root, status, remotes, refNames) : Promise.resolve(null),
    readActivity(root, refLines),
  ]);
  // Compared with the main branch on the remote when known, so "ahead" means not merged yet.
  const [worktrees, checkpointState] = await Promise.all([
    readWorktreeInfo(root, base?.ref ?? (refNames.includes("main") ? "main" : null)),
    readCheckpointState(root),
  ]);
  const worktreeOverlaps = await readOverlaps(root, worktrees);

  return {
    root,
    status,
    remotes,
    stashes: parseStashes(stashOut.stdout),
    history,
    // Without a known main branch (e.g. a local-only repo), main/master by name still leads.
    graph: layoutBranches(commits, {
      base: base?.name ?? (refNames.includes("main") ? "main" : refNames.includes("master") ? "master" : null),
      head: status.branch,
    }),
    unpushed,
    incoming,
    base,
    lastFetch: mtime(gitPaths.FETCH_HEAD),
    operation: detectOperation(gitPaths),
    activity,
    worktrees,
    worktreeOverlaps,
    ...checkpointState,
  };
}

function shortRef(full: string): string {
  return full.replace(/^refs\/(heads|remotes)\//, "");
}

const GIT_PATHS = ["FETCH_HEAD", "MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"];

function mtime(path: string | undefined): number | null {
  try {
    return path ? Math.floor(statSync(path).mtimeMs / 1000) : null;
  } catch {
    return null;
  }
}

function detectOperation(paths: Record<string, string>): Operation | null {
  if (existsSync(paths["rebase-merge"]) || existsSync(paths["rebase-apply"])) return "rebase";
  if (existsSync(paths.MERGE_HEAD)) return "merge";
  if (existsSync(paths.CHERRY_PICK_HEAD)) return "cherry-pick";
  if (existsSync(paths.REVERT_HEAD)) return "revert";
  return null;
}

async function readBase(root: string, status: StatusInfo, remotes: string[], refs: string[]): Promise<BaseInfo | null> {
  const remote = status.upstream?.split("/")[0] ?? (remotes.includes("origin") ? "origin" : (remotes[0] ?? null));
  const remoteDefault = remote
    ? await read(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], root).then(
        (r) => r.stdout.trim(),
        () => null,
      )
    : null;
  const picked = pickBaseRef(remoteDefault, remote, refs);
  if (!picked) return null;

  const isCurrent = picked.name === status.branch || picked.ref === status.branch;
  const [counts, forkPoint] = await Promise.all([
    read(["rev-list", "--left-right", "--count", `HEAD...${picked.ref}`], root),
    read(["merge-base", "HEAD", picked.ref], root).then(
      (r) => r.stdout.trim(),
      () => null,
    ),
  ]);
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);

  // Only a real merge (both sides moved) can conflict; a fast-forward never does.
  let conflicts: string[] | null = null;
  if (!isCurrent && ahead > 0 && behind > 0) conflicts = await predictConflicts(root, picked.ref);

  return { ...picked, ahead, behind, forkPoint, conflicts, isCurrent };
}

/** At most this many overlapping pairs get a merge forecast; each is one in-memory merge. */
const MAX_FORECASTS = 10;

/**
 * Worktrees that changed the same files, and for pairs that both have commits, whether merging
 * those commits would conflict (in memory, like the forecast for main).
 */
async function readOverlaps(root: string, worktrees: readonly WorktreeInfo[]): Promise<WorktreeOverlap[]> {
  const pairs = findOverlaps(worktrees);
  return Promise.all(
    pairs.map(async ({ a, b, files }, i): Promise<WorktreeOverlap> => {
      const tip = (w: WorktreeInfo) => (w.branch ? `refs/heads/${w.branch}` : w.head!);
      const comparable = i < MAX_FORECASTS && !!a.ahead && !!b.ahead && !!a.head && !!b.head;
      const conflicts = comparable ? await predictConflicts(root, tip(b), tip(a)) : null;
      return { a: a.path, b: b.path, files, conflicts };
    }),
  );
}

/** Test-merges in memory with merge-tree: no files, index or refs are touched. */
export async function predictConflicts(root: string, theirs: string, ours = "HEAD"): Promise<string[] | null> {
  try {
    await read(["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs], root);
    return [];
  } catch (error) {
    // Exit code 1 means "merged with conflicts"; anything else (old git, odd history) means unknown.
    if (error instanceof GitError && error.exitCode === 1) return parseMergeTree(error.stdout);
    return null;
  }
}

const ACTIVITY_REFS = 6;
const ACTIVITY_ENTRIES = 4;
const activityCache = new Map<string, { key: string; items: ActivityItem[] }>();

/** Recent movements of remote branches, from their reflogs. Cached until a remote ref changes. */
async function readActivity(root: string, refLines: string[]): Promise<ActivityItem[]> {
  const remoteLines = refLines.filter((line) => {
    const name = line.split("\x1f")[0];
    return name.startsWith("refs/remotes/") && !name.endsWith("/HEAD");
  });
  const key = remoteLines.join("\n");
  const cached = activityCache.get(root);
  if (cached?.key === key) return cached.items;

  const refs = remoteLines.map((line) => shortRef(line.split("\x1f")[0]));
  const perRef = await Promise.all(
    refs.map(async (ref) => {
      const out = await read(
        [
          "reflog",
          "show",
          "--date=unix",
          "--format=%H%x1f%gd%x1f%gs",
          `-n${ACTIVITY_ENTRIES + 1}`,
          `refs/remotes/${ref}`,
        ],
        root,
      ).catch(() => ({ stdout: "" }));
      return { ref, entries: parseReflog(out.stdout) };
    }),
  );

  const recent = perRef
    .filter((r) => r.entries.length > 0)
    .sort((a, b) => b.entries[0].time - a.entries[0].time)
    .slice(0, ACTIVITY_REFS);

  const items = (
    await Promise.all(
      recent.flatMap(({ ref, entries }) =>
        entries.slice(0, ACTIVITY_ENTRIES).map(async (entry, i): Promise<ActivityItem> => {
          const previous = entries[i + 1];
          const byYou = activityKind(entry.subject) === "push";
          if (!previous) return { ref, time: entry.time, kind: "created", byYou, commits: 0, authors: [] };
          const authors = await read(["log", "--format=%an", `${previous.hash}..${entry.hash}`], root).then(
            (r) => lines(r.stdout),
            () => [],
          );
          return {
            ref,
            time: entry.time,
            kind: activityKind(entry.subject),
            byYou,
            commits: authors.length,
            authors: [...new Set(authors)],
          };
        }),
      ),
    )
  )
    .filter((item) => item.commits > 0 || item.kind === "created")
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);

  activityCache.set(root, { key, items });
  return items;
}

/** Just enough for one row in the repository list: one `git status`, no graph or remote work. */
export async function readSummary(root: string, label: string): Promise<RepoSummary> {
  try {
    const { stdout } = await read(["status", "--porcelain=v2", "--branch", "-z"], root);
    const status = parseStatus(stdout);
    return {
      root,
      label,
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      changes: status.files.length,
      conflicts: status.files.filter((f) => f.conflicted).length,
    };
  } catch (error) {
    const message = error instanceof GitError ? error.stderr.trim() : String(error);
    return { root, label, branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, conflicts: 0, error: message };
  }
}

export interface CleanupCandidate {
  branch: Branch;
  reason: string;
}

/**
 * Local branches that are safe to delete: their remote branch is gone (usually a merged PR), or
 * merging them into the base would change nothing. The second check uses merge-tree in memory,
 * so it also catches squash-merged branches, which `git branch --merged` misses.
 */
export async function readCleanupCandidates(
  root: string,
  baseRef: string,
  baseName: string,
): Promise<CleanupCandidate[]> {
  const [branches, baseTree] = await Promise.all([
    readBranches(root),
    read(["rev-parse", `${baseRef}^{tree}`], root).then((r) => r.stdout.trim()),
  ]);
  const candidates = await Promise.all(
    branches
      .filter((b) => !b.current && b.name !== baseName)
      .map(async (branch): Promise<CleanupCandidate | null> => {
        if (branch.gone) return { branch, reason: "remote branch deleted" };
        try {
          const { stdout } = await read(["merge-tree", "--write-tree", baseRef, branch.name], root);
          return stdout.split("\n")[0] === baseTree ? { branch, reason: `already in ${baseName}` } : null;
        } catch {
          return null; // Conflicts or unrelated history: definitely not merged.
        }
      }),
  );
  return candidates.filter((c): c is CleanupCandidate => c !== null);
}

/** Tracked files, for picking one to stop tracking. */
export async function readTrackedFiles(root: string): Promise<string[]> {
  const { stdout } = await read(["ls-files", "-z"], root);
  return stdout.split("\0").filter(Boolean);
}

export async function readBranches(root: string): Promise<Branch[]> {
  const { stdout } = await read(
    ["for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads"],
    root,
  );
  return parseBranches(stdout);
}

export async function readCommitDetails(root: string, hash: string): Promise<CommitDetails> {
  const [meta, files] = await Promise.all([
    read(["show", "-s", "--format=%an%x1f%ae%x1f%at%x1f%B", hash], root),
    // Merges are compared with their first parent, which is what "what did this merge bring in" means.
    read(["show", "--numstat", "-z", "--no-renames", "--diff-merges=first-parent", "--format=", hash], root),
  ]);
  const [author, email, time, ...body] = meta.stdout.split("\x1f");
  return {
    hash,
    author,
    email,
    time: Number(time),
    body: body.join("\x1f").trim(),
    files: parseNumstat(files.stdout),
  };
}
