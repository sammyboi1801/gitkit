import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ActivityItem, BaseInfo, Branch, CommitDetails, Operation, RepoState, StatusInfo } from "../shared/types";
import { BRANCH_FORMAT, parseBranches } from "./branches";
import { layoutGraph } from "./graph";
import { LOG_FORMAT, parseLog } from "./log";
import { parseNumstat, toStatsMap } from "./numstat";
import { activityKind, parseMergeTree, parseReflog, pickBaseRef } from "./remote";
import { GitError, runGit } from "./runner";
import { parseStatus } from "./status";

const GRAPH_LIMIT = 200;

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

// --no-optional-locks everywhere: reads would otherwise refresh the index, which trips our own file watcher.
const read = (args: string[], root: string) => runGit(["--no-optional-locks", ...args], root);
const lines = (text: string) => text.split("\n").filter(Boolean);

export async function readRepo(root: string): Promise<RepoState> {
  const [statusOut, remotesOut, stashOut, unstagedOut, stagedOut] = await Promise.all([
    read(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], root),
    read(["remote"], root),
    read(["stash", "list", "--format=%H"], root),
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

  const { rows, lanes } = layoutGraph(commits);
  return {
    root,
    status,
    remotes,
    stashCount: lines(stashOut.stdout).length,
    rows,
    lanes,
    unpushed,
    incoming,
    base,
    lastFetch: mtime(gitPaths.FETCH_HEAD),
    operation: detectOperation(gitPaths),
    activity,
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

/** Test-merges in memory with merge-tree: no files, index or refs are touched. */
async function predictConflicts(root: string, ref: string): Promise<string[] | null> {
  try {
    await read(["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", ref], root);
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
