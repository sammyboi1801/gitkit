import { randomBytes } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Checkpoint } from "../shared/types";
import { runGit } from "./runner";

// Checkpoints: a snapshot of a worktree's files, new ones included, saved before an agent or a
// risky action changes them. Everything is staged into a throwaway index, written as a commit and
// kept under a private ref, so the user's files, staging area and stash list are never touched.

export const CHECKPOINT_REFS = "refs/gitkit/checkpoints";
const SUBJECT = "GitKit checkpoint: ";

// Checkpoints aren't the user's commits and are never pushed; a fixed identity also means they
// work in repos where no user.name/email is set.
const IDENTITY = {
  GIT_AUTHOR_NAME: "GitKit",
  GIT_AUTHOR_EMAIL: "checkpoint@gitkit.invalid",
  GIT_COMMITTER_NAME: "GitKit",
  GIT_COMMITTER_EMAIL: "checkpoint@gitkit.invalid",
};

export interface CheckpointOptions {
  /** Why it was taken, e.g. "before claude": shown in the Undo list. */
  reason: string;
  /** Files bigger than this are left out, so a checkpoint can't bloat the repo. */
  maxFileBytes: number;
  /** How many checkpoints to keep per worktree, newest first. */
  keep: number;
  /** Checkpoints older than this are dropped. */
  maxAgeDays: number;
  /** For tests; defaults to now. */
  now?: number;
}

export type CheckpointResult =
  /** `skipped`: files left out for being too big. */
  | { kind: "saved"; checkpoint: Checkpoint; skipped: string[] }
  /** Nothing differs from the last commit: the commit already is the checkpoint. */
  | { kind: "unchanged" };

/**
 * Names a worktree inside the refs namespace, which all worktrees share: "main" for the main
 * checkout, otherwise git's own (unique) name for the worktree.
 */
export async function worktreeId(root: string): Promise<string> {
  const gitDir = (await runGit(["rev-parse", "--absolute-git-dir"], root)).stdout.trim().replace(/\\/g, "/");
  return /\/worktrees\/[^/]+$/.test(gitDir) ? basename(gitDir) : "main";
}

export async function createCheckpoint(root: string, options: CheckpointOptions): Promise<CheckpointResult> {
  const now = options.now ?? Date.now();
  const head = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], root).then(
    (r) => r.stdout.trim(),
    () => null, // No commits yet.
  );
  const id = await worktreeId(root);
  // A throwaway index outside the repo; GIT_INDEX_FILE makes every command below use it.
  const index = join(tmpdir(), `gitkit-checkpoint-${randomBytes(6).toString("hex")}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (head) await runGit(["read-tree", head], root, { env });

    // Left out before staging: once `git add` has seen a file, its contents are in the object store.
    const candidates = (await runGit(["ls-files", "-z", "--others", "--modified", "--exclude-standard"], root)).stdout
      .split("\0")
      .filter(Boolean);
    const skipped = [...new Set(candidates)].filter((path) => size(join(root, path)) > options.maxFileBytes);
    await runGit(["add", "-A", "--", ".", ...skipped.map((path) => `:(exclude,literal)${path}`)], root, { env });

    const tree = (await runGit(["write-tree"], root, { env })).stdout.trim();
    if (head && tree === (await runGit(["rev-parse", `${head}^{tree}`], root)).stdout.trim()) {
      return { kind: "unchanged" };
    }
    const reason = options.reason.trim() || "saved";
    const parents = head ? ["-p", head] : [];
    const hash = (
      await runGit(["commit-tree", tree, ...parents, "-m", `${SUBJECT}${reason}`], root, { env: IDENTITY })
    ).stdout.trim();
    const ref = `${CHECKPOINT_REFS}/${id}/${now}`;
    await runGit(["update-ref", ref, hash], root);
    await pruneCheckpoints(root, id, options.keep, options.maxAgeDays, now);
    return { kind: "saved", checkpoint: { ref, hash, time: Math.floor(now / 1000), reason, worktree: id }, skipped };
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

function size(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0; // Deleted: nothing to store.
  }
}

/** Parses `git for-each-ref` output in CHECKPOINT_FORMAT, newest first. */
export function parseCheckpoints(out: string): Checkpoint[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, subject] = line.split("\x1f");
      const parts = ref.slice(CHECKPOINT_REFS.length + 1).split("/");
      return {
        ref,
        hash,
        worktree: parts.slice(0, -1).join("/"),
        time: Math.floor(Number(parts.at(-1)) / 1000),
        reason: subject.startsWith(SUBJECT) ? subject.slice(SUBJECT.length) : subject,
      };
    })
    .filter((c) => Number.isFinite(c.time))
    .sort((a, b) => b.time - a.time || b.ref.localeCompare(a.ref));
}

const CHECKPOINT_FORMAT = "%(refname)%1f%(objectname)%1f%(contents:subject)";

/** Every checkpoint in the repo (all worktrees share refs), newest first. */
export async function listCheckpoints(root: string): Promise<Checkpoint[]> {
  const out = await runGit(["for-each-ref", `--format=${CHECKPOINT_FORMAT}`, CHECKPOINT_REFS], root).then(
    (r) => r.stdout,
    () => "",
  );
  return parseCheckpoints(out);
}

/**
 * This worktree's checkpoints, and those of worktrees that have since been removed (a checkpoint
 * taken just before removal is the point of having one, so they stay findable).
 */
export async function readCheckpointState(
  root: string,
): Promise<{ checkpoints: Checkpoint[]; removedCheckpoints: Checkpoint[] }> {
  const [all, id, common] = await Promise.all([
    listCheckpoints(root),
    worktreeId(root).catch(() => "main"),
    runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], root).then(
      (r) => r.stdout.trim(),
      () => null,
    ),
  ]);
  const gone = (c: Checkpoint) =>
    c.worktree !== "main" && c.worktree !== id && !!common && !existsSync(join(common, "worktrees", c.worktree));
  return { checkpoints: all.filter((c) => c.worktree === id), removedCheckpoints: all.filter(gone) };
}

/**
 * Which checkpoints to drop: past the newest `keep`, or older than `maxAgeDays`. Dropped refs stop
 * keeping their files alive, so git's normal clean-up can reclaim the space.
 */
export function checkpointsToDrop(
  checkpoints: readonly Checkpoint[],
  keep: number,
  maxAgeDays: number,
  now: number,
): Checkpoint[] {
  const oldest = now / 1000 - maxAgeDays * 86_400;
  return checkpoints.filter((c, i) => i >= keep || c.time < oldest);
}

async function pruneCheckpoints(root: string, id: string, keep: number, maxAgeDays: number, now: number) {
  const mine = (await listCheckpoints(root)).filter((c) => c.worktree === id);
  for (const c of checkpointsToDrop(mine, keep, maxAgeDays, now)) {
    await runGit(["update-ref", "-d", c.ref], root);
  }
}

const RUNNERS = new Set(["npx", "pnpx", "bunx", "pnpm", "yarn", "bun", "uvx", "pipx"]);

/**
 * The agent a terminal command starts, from its command line: "claude", "FOO=1 claude -p",
 * "npx codex", "C:\tools\aider.exe" all count; "claude-notes.txt" or "git commit" don't.
 */
export function agentCommand(commandLine: string, agents: readonly string[]): string | null {
  const names = new Set(agents.map((a) => a.toLowerCase()));
  // Quoted words stay whole: "C:\Program Files\x\agent.exe" is one program.
  const words = commandLine.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  // PowerShell runs a quoted program with its call operator: & 'C:\...\claude.exe'.
  let i = words[0] === "&" ? 1 : 0;
  // Leading environment assignments (FOO=1), then a package runner (npx, pnpm dlx, ...).
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  if (RUNNERS.has(words[i]?.toLowerCase())) {
    i++;
    if (words[i] === "dlx" || words[i] === "run" || words[i] === "exec") i++;
    while (words[i]?.startsWith("-")) i++;
  }
  const word = words[i]?.replace(/^["']|["']$/g, "");
  if (!word) return null;
  const program = word
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(exe|cmd|bat|ps1|sh)$/i, "")
    .toLowerCase();
  // Scoped npm packages: @anthropic-ai/claude-code runs "claude".
  const unscoped = program.replace(/^@[^/]+\//, "");
  for (const name of [program, unscoped, unscoped.replace(/-code$/, "")]) if (names.has(name)) return name;
  return null;
}
