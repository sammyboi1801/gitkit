import { normalizeRemote } from "../git/guard";
import type { CiStatus } from "../shared/types";

// Pure helpers for GitHub CI: which repo a remote is, and what a commit's checks add up to.

export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = /^github\.com\/([^/]+)\/([^/]+)$/i.exec(normalizeRemote(url));
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** The subset of GitHub's check-run object GitKit reads. */
export interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "stale"
    | null
    | string;
  html_url: string | null;
  /** For Actions, ".../actions/runs/<run id>/job/<job id>". */
  details_url: string | null;
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

export function summarizeChecks(sha: string, runs: readonly CheckRun[], actionsUrl: string): CiStatus {
  if (runs.length === 0) {
    return { state: "none", sha, summary: "No checks on this commit", failed: [], url: actionsUrl, runId: null };
  }
  const failed = runs.filter((r) => r.status === "completed" && FAILED.has(r.conclusion ?? ""));
  const pending = runs.filter((r) => r.status !== "completed");
  const firstFailed = failed[0];
  const runId = runIdFrom(firstFailed?.details_url ?? firstFailed?.html_url ?? null);

  if (failed.length) {
    return {
      state: "failure",
      sha,
      summary: `${failed.length} of ${runs.length} check${runs.length === 1 ? "" : "s"} failed`,
      failed: failed.map((r) => r.name),
      url: firstFailed.html_url ?? actionsUrl,
      runId,
    };
  }
  if (pending.length) {
    return {
      state: "pending",
      sha,
      summary: `${pending.length} of ${runs.length} running`,
      failed: [],
      url: pending[0].html_url ?? actionsUrl,
      runId: null,
    };
  }
  return {
    state: "success",
    sha,
    summary: `All ${runs.length} check${runs.length === 1 ? "" : "s"} passed`,
    failed: [],
    url: actionsUrl,
    runId: null,
  };
}

export function runIdFrom(url: string | null): number | null {
  const match = url ? /\/actions\/runs\/(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : null;
}
