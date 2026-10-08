import type { Branch, CommitDetails, RepoState } from "../shared/types";
import { BRANCH_FORMAT, parseBranches } from "./branches";
import { layoutGraph } from "./graph";
import { LOG_FORMAT, parseLog } from "./log";
import { parseNumstat, toStatsMap } from "./numstat";
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

  const { rows, lanes } = layoutGraph(commits);
  return {
    root,
    status,
    remotes: lines(remotesOut.stdout),
    stashCount: lines(stashOut.stdout).length,
    rows,
    lanes,
    unpushed,
    incoming,
  };
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
