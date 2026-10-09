import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Worktree, WorktreeInfo } from "../shared/types";
import { pathKey, samePath } from "./paths";
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

// Names Windows won't allow as a file or folder, whatever the extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** "feature/login" → "feature-login": one folder (not nested ones), valid on every OS. */
export function worktreeFolderName(branch: string): string {
  const name = [...branch]
    // Control characters, then the ones Windows forbids in file names.
    .map((c) => (c.charCodeAt(0) < 32 ? "-" : c))
    .join("")
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/-{2,}/g, "-")
    // Windows drops trailing dots and spaces; a leading dot would hide the folder.
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  if (!name) return "worktree";
  return RESERVED.test(name) ? `${name}-worktree` : name;
}

export type WorktreeLocation = "sibling" | "inside";

/**
 * Where GitKit creates a worktree for `branch`: next to the repo in <repo>.worktrees/, or inside it
 * in .worktrees/. A name that's taken (by a folder or another worktree) gets -2, -3 and so on.
 */
export function newWorktreePath(
  mainRoot: string,
  branch: string,
  location: WorktreeLocation,
  taken: (path: string) => boolean,
): string {
  const parent =
    location === "inside" ? join(mainRoot, ".worktrees") : join(dirname(mainRoot), `${basename(mainRoot)}.worktrees`);
  const name = worktreeFolderName(branch);
  for (let n = 1; ; n++) {
    const path = join(parent, n === 1 ? name : `${name}-${n}`);
    if (!taken(path)) return path;
  }
}

/**
 * The repo's info/exclude with `.worktrees/` added, or null when it's already there. Excluded there,
 * not in .gitignore, so choosing in-repo worktrees doesn't leave a change to commit.
 */
export function withWorktreesExcluded(exclude: string): string | null {
  if (exclude.split(/\r?\n/).some((line) => /^\/?\.worktrees\/?$/.test(line.trim()))) return null;
  const sep = exclude && !exclude.endsWith("\n") ? "\n" : "";
  return `${exclude}${sep}# Worktrees created by GitKit\n/.worktrees/\n`;
}

/**
 * Which of the files the user listed to copy into a new worktree (things git ignores, like .env)
 * can be copied: they must exist, stay inside the repo, and not already be there.
 */
export function filesToCopy(
  listed: readonly string[],
  from: string,
  to: string,
  exists: (path: string) => boolean,
): { copy: { from: string; to: string; name: string }[]; skipped: { name: string; why: string }[] } {
  const copy: { from: string; to: string; name: string }[] = [];
  const skipped: { name: string; why: string }[] = [];
  for (const raw of listed) {
    const name = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!name) continue;
    if (isAbsolute(name) || /^[a-z]:/i.test(name) || name.split("/").includes("..")) {
      skipped.push({ name: raw, why: "must be a path inside the repo" });
      continue;
    }
    const source = join(from, name);
    const target = join(to, name);
    if (!exists(source)) skipped.push({ name, why: "not found" });
    else if (exists(target)) skipped.push({ name, why: "already there" });
    else copy.push({ from: source, to: target, name });
  }
  return { copy, skipped };
}

/** More would mean many git calls on every refresh; past this, the rest are listed without details. */
const MAX_DETAILED = 12;
/** Files remembered per worktree for spotting overlaps; enough for any sane change. */
const MAX_TOUCHED = 2000;
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
export async function readWorktreeInfo(
  root: string,
  base: string | null,
  options: { maxAgeMs?: number } = {},
): Promise<WorktreeInfo[]> {
  const list = await readWorktrees(root).catch(() => [] as Worktree[]);
  if (list.length < 2) return [];
  const maxAge = options.maxAgeMs ?? OTHERS_MAX_AGE_MS;
  return Promise.all(
    list.map(async (w, i): Promise<WorktreeInfo> => {
      const info: WorktreeInfo = {
        ...w,
        current: samePath(w.path, root),
        changes: null,
        ahead: null,
        behind: null,
        lastActivity: null,
        touched: null,
      };
      if (w.bare || w.prunable !== null || !w.head || i >= MAX_DETAILED) return info;

      // Other worktrees don't change because this one did, which is what triggers most refreshes;
      // a recent reading of them is reused unless their branch or commit moved.
      const key = `${w.head}|${w.branch}|${base}`;
      const cached = details.get(pathKey(w.path));
      if (!info.current && cached && cached.key === key && Date.now() - cached.at < maxAge) {
        return { ...info, ...cached.details };
      }
      const read = await readDetails(w, root, base);
      details.set(pathKey(w.path), { key, at: Date.now(), details: read });
      return { ...info, ...read };
    }),
  );
}

/** How long another worktree's details are reused between refreshes. */
const OTHERS_MAX_AGE_MS = 10_000;

type Details = Pick<WorktreeInfo, "changes" | "ahead" | "behind" | "lastActivity" | "touched">;
const details = new Map<string, { key: string; at: number; details: Details }>();

async function readDetails(w: Worktree, root: string, base: string | null): Promise<Details> {
  const info: Details = { changes: null, ahead: null, behind: null, lastActivity: null, touched: null };
  const tip = w.branch ? `refs/heads/${w.branch}` : w.head!;
  const [status, time, counts, committed] = await Promise.all([
    read(["status", "--porcelain", "-z", "--untracked-files=all"], w.path).catch(() => null),
    read(["log", "-1", "--format=%ct", w.head!], root).catch(() => null),
    base ? read(["rev-list", "--left-right", "--count", `${base}...${tip}`], root).catch(() => null) : null,
    // Three dots: what the branch changed since it left main, not what main did since.
    base ? read(["diff", "--name-only", "-z", `${base}...${tip}`], root).catch(() => null) : null,
  ]);
  let paths: string[] = [];
  if (status) {
    paths = parseStatusPaths(status.stdout);
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
  if (status) {
    const files = new Set([...(committed?.stdout.split("\0").filter(Boolean) ?? []), ...paths]);
    info.touched = [...files].sort().slice(0, MAX_TOUCHED);
  }
  return info;
}

/**
 * Pairs of worktrees that changed the same files since leaving main, committed or not: two agents
 * editing auth.py in parallel is worth knowing before either tries to merge.
 */
export function findOverlaps(
  worktrees: readonly WorktreeInfo[],
): { a: WorktreeInfo; b: WorktreeInfo; files: string[] }[] {
  const pairs: { a: WorktreeInfo; b: WorktreeInfo; files: string[] }[] = [];
  const live = worktrees.filter((w) => w.touched?.length);
  for (let i = 0; i < live.length; i++) {
    const mine = new Set(live[i].touched);
    for (let j = i + 1; j < live.length; j++) {
      const files = live[j].touched!.filter((f) => mine.has(f));
      if (files.length) pairs.push({ a: live[i], b: live[j], files });
    }
  }
  return pairs;
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
