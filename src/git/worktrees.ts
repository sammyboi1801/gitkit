import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Worktree, WorktreeInfo } from "../shared/types";
import { samePath } from "./paths";
import { runGit } from "./runner";

// Worktrees: every checkout of a repo, as git lists them (including ones made by the CLI or by
// agent tools, wherever they live), and how to tell a worktree's folder from a repo's own.

/**
 * Parses `git worktree list --porcelain -z`: one NUL-terminated line per attribute, and an empty
 * line between worktrees. The first one listed is always the main worktree.
 */
export function parseWorktreeList(out: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Worktree | null = null;
  for (const line of out.split("\0")) {
    if (!line) {
      current = null;
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      current = {
        path: resolve(value),
        head: null,
        branch: null,
        main: worktrees.length === 0,
        bare: false,
        locked: null,
        prunable: null,
      };
      worktrees.push(current);
    } else if (current) {
      if (key === "HEAD") current.head = value;
      else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") current.bare = true;
      // Present without a value when locked or prunable for no stated reason.
      else if (key === "locked") current.locked = value;
      else if (key === "prunable") current.prunable = value;
    }
  }
  return worktrees;
}

export async function readWorktrees(root: string): Promise<Worktree[]> {
  const { stdout } = await runGit(["worktree", "list", "--porcelain", "-z"], root);
  return parseWorktreeList(stdout);
}

/** More would mean many git calls on every refresh; past this, the rest are listed without details. */
const MAX_DETAILED = 12;
/** Changed files whose modification times are checked for "last activity". */
const MAX_STATTED = 200;

const read = (args: string[], cwd: string) => runGit(["--no-optional-locks", ...args], cwd);

/** Paths in `git status --porcelain -z`; a rename's second field is its old path, not another file. */
export function parseStatusPaths(out: string): string[] {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    if (field[0] === "R" || field[0] === "C") i++;
  }
  return paths;
}

/**
 * Every worktree with what's going on in it: uncommitted files, distance from `base`, and when it
 * last changed (newest of its last commit and its changed files, so an agent that hasn't committed
 * yet still shows as active). Empty when the repo has only its own checkout.
 */
export async function readWorktreeInfo(root: string, base: string | null): Promise<WorktreeInfo[]> {
  const list = await readWorktrees(root).catch(() => [] as Worktree[]);
  if (list.length < 2) return [];
  return Promise.all(
    list.map(async (w, i): Promise<WorktreeInfo> => {
      const info: WorktreeInfo = {
        ...w,
        current: samePath(w.path, root),
        changes: null,
        ahead: null,
        behind: null,
        lastActivity: null,
      };
      if (w.bare || w.prunable !== null || !w.head || i >= MAX_DETAILED) return info;

      const tip = w.branch ? `refs/heads/${w.branch}` : w.head;
      const [status, time, counts] = await Promise.all([
        read(["status", "--porcelain", "-z", "--untracked-files=all"], w.path).catch(() => null),
        read(["log", "-1", "--format=%ct", w.head], root).catch(() => null),
        base ? read(["rev-list", "--left-right", "--count", `${base}...${tip}`], root).catch(() => null) : null,
      ]);
      if (status) {
        const paths = parseStatusPaths(status.stdout);
        info.changes = paths.length;
        const times = paths.slice(0, MAX_STATTED).map((p) => {
          try {
            return Math.floor(statSync(resolve(w.path, p)).mtimeMs / 1000);
          } catch {
            return 0; // Deleted files have no time of their own.
          }
        });
        info.lastActivity = Math.max(Number(time?.stdout.trim()) || 0, ...times) || null;
      }
      const [behind, ahead] = (counts?.stdout.trim().split(/\s+/) ?? []).map(Number);
      if (Number.isFinite(behind) && Number.isFinite(ahead)) Object.assign(info, { ahead, behind });
      return info;
    }),
  );
}

export type GitFolder =
  | { kind: "repo" }
  /** A linked worktree; `mainRoot` is the main worktree's folder (null for a bare repo's). */
  | { kind: "worktree"; mainRoot: string | null }
  | { kind: "submodule" }
  | { kind: "none" };

/**
 * What a folder's `.git` says it is, from the files alone (no git process, so the repo scan stays
 * fast). A repo has a `.git` folder; worktrees and submodules have a `.git` file pointing at their
 * git dir. Only a worktree's git dir has a `commondir` file, which leads back to the main repo.
 */
export function gitFolderKind(dir: string): GitFolder {
  const dotGit = resolve(dir, ".git");
  let stat;
  try {
    stat = statSync(dotGit);
  } catch {
    return { kind: "none" };
  }
  if (stat.isDirectory()) return { kind: "repo" };

  let gitDir: string;
  try {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
    if (!match) return { kind: "repo" };
    gitDir = resolve(dir, match[1]);
  } catch {
    return { kind: "repo" };
  }

  let common: string;
  try {
    common = resolve(gitDir, readFileSync(resolve(gitDir, "commondir"), "utf8").trim());
  } catch {
    // No commondir: a submodule (git dir under the parent's .git/modules), or a repo whose git
    // dir was moved elsewhere with --separate-git-dir. Either way, a repo of its own.
    return gitDir.replace(/\\/g, "/").includes("/.git/modules/") ? { kind: "submodule" } : { kind: "repo" };
  }
  // A normal repo's common dir is its .git folder; a bare repo's is the repo itself.
  return { kind: "worktree", mainRoot: basename(common) === ".git" ? dirname(common) : null };
}
