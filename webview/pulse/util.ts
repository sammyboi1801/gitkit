import { planAction, type ActionRequest } from "../../src/git/actions";
import { formatCommand } from "../../src/git/format";
import type { RepoState, WorktreeInfo } from "../../src/shared/types";

/** The exact command(s) an action will run, or why it can't run. Shown on hover and under buttons. */
export function preview(request: ActionRequest, repo: RepoState): { ok: boolean; text: string; label: string } {
  const result = planAction(request, repo);
  if (!result.ok) return { ok: false, text: result.reason, label: "" };
  return { ok: true, text: result.plan.steps.map(formatCommand).join(" && "), label: result.plan.label };
}

/** The one remote action that makes sense right now, or null when there's nothing to send or get. */
export function suggestedSync(repo: RepoState): "push" | "pull" | "sync" | null {
  const { status } = repo;
  if (!status.branch || repo.remotes.length === 0) return null;
  if (!status.upstream) return "push";
  if (status.ahead && status.behind) return "sync";
  if (status.behind) return "pull";
  if (status.ahead) return "push";
  return null;
}

/**
 * A worktree's folder as a short label: relative to the folder the main checkout sits in
 * ("app.worktrees/feature-login"), or the full path when it lives somewhere else.
 */
export function worktreeLabel(path: string, mainPath: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = norm(path);
  const parent = norm(mainPath).replace(/\/[^/]*$/, "");
  // Windows paths compare case-insensitively.
  const inside = target.toLowerCase().startsWith(`${parent.toLowerCase()}/`);
  return inside && parent ? target.slice(parent.length + 1) : target;
}

/** A worktree's name for people: its branch, or where it's detached. */
export function worktreeName(w: WorktreeInfo): string {
  return w.bare ? "bare repository" : (w.branch ?? `detached at ${w.head?.slice(0, 7) ?? "?"}`);
}

const fileList = (files: readonly string[], max = 3) =>
  files.length > max ? `${files.slice(0, max).join(", ")} +${files.length - max} more` : files.join(", ");

/**
 * What a worktree has in common with the others: "also changed in agent/docs: auth.py", or, when
 * merging their commits would conflict, "conflicts with agent/docs in auth.py".
 */
export function overlapNotes(path: string, repo: RepoState): { text: string; tone: "warn" | "conflict" }[] {
  const byPath = new Map(repo.worktrees.map((w) => [w.path, w]));
  return repo.worktreeOverlaps
    .filter((o) => o.a === path || o.b === path)
    .map((o) => {
      const other = byPath.get(o.a === path ? o.b : o.a);
      const name = other ? worktreeName(other) : "another worktree";
      return o.conflicts?.length
        ? { text: `conflicts with ${name} in ${fileList(o.conflicts)}`, tone: "conflict" as const }
        : { text: `also changed in ${name}: ${fileList(o.files)}`, tone: "warn" as const };
    });
}

/** The worst overlap between worktrees in one line (conflicts first), for the Branch Map's strip. */
export function overlapSummary(repo: RepoState): { text: string; tone: "warn" | "conflict"; more: number } | null {
  const overlaps = [...repo.worktreeOverlaps].sort(
    (x, y) => Number(!!y.conflicts?.length) - Number(!!x.conflicts?.length),
  );
  const first = overlaps[0];
  if (!first) return null;
  const byPath = new Map(repo.worktrees.map((w) => [w.path, w]));
  const name = (path: string) => {
    const w = byPath.get(path);
    return w ? worktreeName(w) : "a worktree";
  };
  const pair = `${name(first.a)} and ${name(first.b)}`;
  return first.conflicts?.length
    ? { text: `${pair} would conflict in ${fileList(first.conflicts, 2)}`, tone: "conflict", more: overlaps.length - 1 }
    : { text: `${pair} both changed ${fileList(first.files, 2)}`, tone: "warn", more: overlaps.length - 1 };
}

/** One plain-English sentence describing where the repo stands. */
export function summarize(repo: RepoState): { text: string; icon: string; tone: string } {
  const { status } = repo;
  const conflicts = status.files.filter((f) => f.conflicted).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (repo.operation) {
    const what =
      repo.operation === "cherry-pick" ? "Cherry-pick" : repo.operation[0].toUpperCase() + repo.operation.slice(1);
    return conflicts
      ? { text: `${what} paused: ${plural(conflicts, "conflict")} to resolve`, icon: "warning", tone: "conflict" }
      : { text: `${what} in progress: continue when ready`, icon: "debug-pause", tone: "warn" };
  }
  if (conflicts) return { text: `${plural(conflicts, "conflict")} to resolve`, icon: "warning", tone: "conflict" };
  if (!status.branch) return { text: "Detached HEAD: create a branch to keep work", icon: "warning", tone: "warn" };
  if (repo.remotes.length === 0) return { text: "No remote configured", icon: "circle-slash", tone: "muted" };
  if (!status.upstream) return { text: "Not on the remote yet. Publish to share it", icon: "cloud", tone: "info" };
  if (status.ahead && status.behind) {
    return {
      text: `Diverged: ${status.ahead} to push, ${status.behind} to pull. Sync replays yours on top`,
      icon: "git-compare",
      tone: "warn",
    };
  }
  if (status.behind)
    return { text: `${plural(status.behind, "new commit")} on the remote`, icon: "arrow-down", tone: "info" };
  if (status.ahead) return { text: `${plural(status.ahead, "commit")} ready to push`, icon: "arrow-up", tone: "info" };
  // In sync with your remote branch, but main moved on in a way that will bite: say that first.
  const base = repo.base && !repo.base.isCurrent ? repo.base : null;
  if (base && base.behind && base.conflicts?.length) {
    return {
      text: `${base.name} has ${plural(base.behind, "new commit")} that would conflict`,
      icon: "warning",
      tone: "warn",
    };
  }
  if (status.files.length)
    return {
      text: `In sync with remote · ${plural(status.files.length, "changed file")}`,
      icon: "edit",
      tone: "muted",
    };
  return { text: "Clean and in sync with remote", icon: "pass", tone: "ok" };
}

export function totals(stats: ({ added: number; removed: number } | undefined)[]): { added: number; removed: number } {
  return stats.reduce<{ added: number; removed: number }>(
    (sum, s) => ({ added: sum.added + (s?.added ?? 0), removed: sum.removed + (s?.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
}

/** Hashes reachable from HEAD within the loaded graph, to decide between revert and cherry-pick. */
export function headAncestors(repo: RepoState): Set<string> {
  const parents = new Map(repo.graph.commits.map((c) => [c.hash, c.parents]));
  const seen = new Set<string>();
  const stack = repo.status.oid ? [repo.status.oid] : [];
  while (stack.length) {
    const hash = stack.pop()!;
    if (seen.has(hash) || !parents.has(hash)) continue;
    seen.add(hash);
    stack.push(...parents.get(hash)!);
  }
  return seen;
}

export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { name: path, dir: "" } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/** "3m ago", "just now". */
export function ago(unixSeconds: number, now = Date.now()): string {
  const t = relativeTime(unixSeconds, now);
  return t === "now" ? "just now" : `${t} ago`;
}

export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(now / 1000 - unixSeconds));
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "y"],
    [60 * 60 * 24 * 30, "mo"],
    [60 * 60 * 24 * 7, "w"],
    [60 * 60 * 24, "d"],
    [60 * 60, "h"],
    [60, "m"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit}`;
  }
  return "now";
}

/** Letter and colour class for a file's status, matching VS Code's own decorations. */
export function badge(letter: string | null, untracked: boolean): { text: string; tone: string } {
  if (untracked) return { text: "U", tone: "untracked" };
  switch (letter) {
    case "A":
      return { text: "A", tone: "added" };
    case "D":
      return { text: "D", tone: "deleted" };
    case "R":
    case "C":
      return { text: letter, tone: "renamed" };
    case "U":
      return { text: "!", tone: "conflict" };
    default:
      return { text: letter ?? "", tone: "modified" };
  }
}
