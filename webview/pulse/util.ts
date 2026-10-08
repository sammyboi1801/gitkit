import { planAction, type ActionRequest } from "../../src/git/actions";
import { formatCommand } from "../../src/git/format";
import type { RepoState } from "../../src/shared/types";

/** The exact command(s) an action will run, or why it can't run. Shown on hover and under buttons. */
export function preview(request: ActionRequest, repo: RepoState): { ok: boolean; text: string; label: string } {
  const result = planAction(request, repo);
  if (!result.ok) return { ok: false, text: result.reason, label: "" };
  return { ok: true, text: result.plan.steps.map(formatCommand).join(" && "), label: result.plan.label };
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
  if (status.files.length)
    return { text: `Up to date · ${plural(status.files.length, "changed file")}`, icon: "edit", tone: "muted" };
  return { text: "Clean and up to date", icon: "pass", tone: "ok" };
}

export function totals(stats: ({ added: number; removed: number } | undefined)[]): { added: number; removed: number } {
  return stats.reduce<{ added: number; removed: number }>(
    (sum, s) => ({ added: sum.added + (s?.added ?? 0), removed: sum.removed + (s?.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
}

/** Hashes reachable from HEAD within the loaded graph, to decide between revert and cherry-pick. */
export function headAncestors(repo: RepoState): Set<string> {
  const parents = new Map(repo.rows.map((r) => [r.commit.hash, r.commit.parents]));
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
