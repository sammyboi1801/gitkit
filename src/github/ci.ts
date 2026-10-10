import { normalizeRemote } from "../git/guard";
import type { CiError, CiFailure, CiStatus } from "../shared/types";

// Pure helpers for GitHub CI: which repo a remote is, what a commit's checks add up to, and where
// and why the failed ones failed.

export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = /^github\.com\/([^/]+)\/([^/]+)$/i.exec(normalizeRemote(url));
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** The subset of GitHub's check-run object GitKit reads. */
export interface CheckRun {
  id?: number;
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

/** The subset of GitHub's Actions job object GitKit reads. */
export interface Job {
  id: number;
  name: string;
  html_url: string | null;
  steps?: JobStep[];
}

export interface JobStep {
  name: string;
  number: number;
  conclusion: string | null;
  /** Whole seconds, e.g. "2026-10-09T04:14:07Z". */
  started_at: string | null;
  completed_at: string | null;
}

/** The subset of GitHub's check-run annotation object GitKit reads. */
export interface Annotation {
  path: string;
  start_line: number | null;
  annotation_level: "notice" | "warning" | "failure" | string;
  title: string | null;
  message: string;
  blob_href: string | null;
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

export const isFailed = (run: CheckRun) => run.status === "completed" && FAILED.has(run.conclusion ?? "");

/**
 * How long background CI checks wait between tries. Signed out, GitHub allows 60 requests an
 * hour from one address and a check costs up to four, so it waits longer.
 */
export function ciPollInterval(state: CiStatus["state"] | undefined, signedIn: boolean): number {
  if (signedIn) return state === "pending" ? 60_000 : 300_000;
  return state === "pending" ? 300_000 : 900_000;
}

export function summarizeChecks(sha: string, runs: readonly CheckRun[], actionsUrl: string): CiStatus {
  const status = { sha, failed: [] as string[], runId: null, failures: [] };
  if (runs.length === 0) {
    return { ...status, state: "none", summary: "No checks on this commit", url: actionsUrl };
  }
  const failed = runs.filter(isFailed);
  const pending = runs.filter((r) => r.status !== "completed");
  const firstFailed = failed[0];

  if (failed.length) {
    return {
      ...status,
      state: "failure",
      summary: `${failed.length} of ${runs.length} check${runs.length === 1 ? "" : "s"} failed`,
      failed: failed.map((r) => r.name),
      url: firstFailed.html_url ?? actionsUrl,
      runId: runIdFrom(firstFailed.details_url ?? firstFailed.html_url ?? null),
    };
  }
  if (pending.length) {
    return {
      ...status,
      state: "pending",
      summary: `${pending.length} of ${runs.length} running`,
      url: pending[0].html_url ?? actionsUrl,
    };
  }
  return {
    ...status,
    state: "success",
    summary: `All ${runs.length} check${runs.length === 1 ? "" : "s"} passed`,
    url: actionsUrl,
  };
}

export function runIdFrom(url: string | null): number | null {
  const match = url ? /\/actions\/runs\/(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : null;
}

/** The Actions job behind a check run; null for checks from other apps. */
export function jobIdFrom(url: string | null): number | null {
  const match = url ? /\/actions\/runs\/\d+\/job\/(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : null;
}

export function failedStep(job: Job | null): JobStep | null {
  return job?.steps?.find((s) => FAILED.has(s.conclusion ?? "")) ?? null;
}

/** "Run npm test" → "npm test": GitHub names unnamed steps after their command or action. */
export const stepName = (step: JobStep) => step.name.replace(/^Run /, "");

/**
 * A path in an annotation, as a path in the repo. GitHub uses ".github" for errors about no file
 * in particular, and some tools report absolute paths on the runner, which live under
 * /home/runner/work/<repo>/<repo>/ (D:\a\<repo>\<repo>\ on Windows).
 */
export function annotationPath(path: string, repo: string): string | null {
  let p = path.trim().replace(/\\/g, "/");
  if (!p || p === ".github") return null;
  if (/^([a-z]:)?\//i.test(p)) {
    const marker = `/${repo}/${repo}/`.toLowerCase();
    const at = p.toLowerCase().indexOf(marker);
    if (at === -1) return null;
    p = p.slice(at + marker.length);
  }
  p = p.replace(/^(\.\/)+/, "");
  return p && !p.split("/").includes("..") ? p : null;
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";

/** The errors worth showing: failures, minus "Process completed with exit code 1" (the step says that). */
export function errorsFrom(annotations: readonly Annotation[], repo: string): CiError[] {
  const errors: CiError[] = [];
  const seen = new Set<string>();
  for (const a of annotations) {
    if (a.annotation_level !== "failure") continue;
    if (/^Process completed with exit code \d+\.?$/.test(a.message.trim())) continue;
    const file = annotationPath(a.path, repo);
    const line = file && a.start_line ? a.start_line : null;
    // Test reporters title an error "[project] file > suite > test": the test's name says the most.
    const title = a.title?.trim() ?? "";
    const text = (title ? title.split(" > ").at(-1)!.trim() : "") || firstLine(a.message);
    const key = `${file}:${line}:${text}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    errors.push({
      text,
      detail: a.message.trim(),
      file,
      line,
      url: file && a.blob_href ? `${a.blob_href}${line ? `#L${line}` : ""}` : null,
    });
  }
  return errors;
}

/**
 * The failed checks, with the step and errors each failed with. Jobs that failed the same way
 * (a matrix: the same test failing on every Node version) are listed together once.
 */
export function describeFailures(
  failed: readonly { run: CheckRun; job: Job | null; annotations: readonly Annotation[] }[],
  repo: string,
): CiFailure[] {
  const failures: CiFailure[] = [];
  const keys: string[] = [];
  for (const { run, job, annotations } of failed) {
    const step = failedStep(job);
    const errors = errorsFrom(annotations, repo);
    const jobId = job?.id ?? jobIdFrom(run.details_url ?? run.html_url);
    const jobUrl = job?.html_url ?? run.html_url ?? run.details_url ?? "";
    const url = step && jobUrl ? `${jobUrl}#step:${step.number}:1` : jobUrl;
    const name = step ? stepName(step) : null;
    // Nothing to compare for checks we know nothing about, so those are never merged.
    const key = name || errors.length ? JSON.stringify([name, errors.map((e) => [e.file, e.line, e.text])]) : "";
    const same = key ? keys.indexOf(key) : -1;
    if (same !== -1) failures[same].jobs.push(job?.name ?? run.name);
    else {
      keys.push(key);
      failures.push({ jobs: [job?.name ?? run.name], jobId, step: name, url, errors });
    }
  }
  return failures;
}
