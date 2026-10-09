import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Worktree } from "../shared/types";
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

/** Resolves junctions, symlinks and 8.3 short names, so two spellings of a folder compare equal. */
export function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
