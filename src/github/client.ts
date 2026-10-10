import * as vscode from "vscode";
import { runGit } from "../git/runner";
import type { CiFailure, CiStatus, PrState, PullRequest, RepoState } from "../shared/types";
import {
  describeFailures,
  failedStep,
  isFailed,
  jobIdFrom,
  parseGitHubRemote,
  summarizeChecks,
  type Annotation,
  type CheckRun,
  type Job,
} from "./ci";
import { formatFailedLog } from "./logs";
import { PR_QUERY, compareUrl, pullFromGraphql, pullFromRest, type RestPull, type RestReview } from "./pr";

// GitHub calls for CI status and pull requests. Public repos work without signing in; private ones use the
// GitHub account VS Code already manages, and GitKit never prompts unless the user clicks Sign in.

const API = "https://api.github.com";
const SCOPES = ["repo"];

/** Until when GitHub said its rate limit is used up (ms), and whether the last call was signed in. */
const limits = { until: 0, signedIn: false };

/** What background checks need to stay within GitHub's rate limit. */
export function githubLimits(): { limitedUntil: number; signedIn: boolean } {
  return { limitedUntil: limits.until, signedIn: limits.signedIn };
}

async function token(prompt: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      SCOPES,
      prompt ? { createIfNone: true } : { silent: true },
    );
    limits.signedIn = !!session;
    return session?.accessToken;
  } catch {
    return undefined; // The user dismissed sign-in.
  }
}

async function github(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "GitKit-VSCode",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...init.headers,
    },
  });
  // GitHub says when the hourly allowance runs out and when it comes back.
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    limits.until = reset > 0 ? reset : Date.now() + 15 * 60_000;
  } else if (remaining !== null) {
    limits.until = 0;
  }
  return response;
}

type GitHubRepo = { owner: string; repo: string };

async function githubRepo(repo: RepoState): Promise<GitHubRepo | null> {
  const remote = repo.status.upstream?.split("/")[0] ?? (repo.remotes.includes("origin") ? "origin" : repo.remotes[0]);
  if (!remote) return null;
  const url = await runGit(["remote", "get-url", remote], repo.root).then(
    (r) => r.stdout.trim(),
    () => "",
  );
  return parseGitHubRemote(url);
}

/** CI for the latest pushed commit of the current branch; null when there's nothing to show. */
export async function readCi(repo: RepoState, prompt = false): Promise<CiStatus | null> {
  const gh = await githubRepo(repo);
  if (!gh || !repo.status.upstream) return null;
  const sha = await runGit(["rev-parse", "@{upstream}"], repo.root).then(
    (r) => r.stdout.trim(),
    () => "",
  );
  if (!sha) return null;

  const actionsUrl = `https://github.com/${gh.owner}/${gh.repo}/actions`;
  const unknown = { sha, failed: [], url: actionsUrl, runId: null, failures: [] };
  const auth = await token(prompt);
  const response = await github(`/repos/${gh.owner}/${gh.repo}/commits/${sha}/check-runs?per_page=100`, {}, auth);

  // 404 for a private repo, 403/429 when rate-limited: both fixed by signing in.
  if ((response.status === 404 || response.status === 403 || response.status === 429) && !auth) {
    return { ...unknown, state: "signin", summary: "Sign in to GitHub to see CI" };
  }
  if (!response.ok) return { ...unknown, state: "error", summary: `GitHub said ${response.status}` };
  const runs = ((await response.json()) as { check_runs?: CheckRun[] }).check_runs ?? [];
  const status = summarizeChecks(sha, runs, actionsUrl);
  if (status.state === "failure") status.failures = await readFailures(gh, runs.filter(isFailed), auth);
  return status;
}

/** Failed checks looked at in detail; more than this is rare, and each costs two requests. */
const MAX_FAILURES = 5;
/** A finished job's steps and errors never change, so they're read once (per GitKit session). */
const details = new Map<string, Promise<{ job: Job | null; annotations: Annotation[] }>>();

async function readFailures(gh: GitHubRepo, failed: CheckRun[], auth?: string): Promise<CiFailure[]> {
  const read = async <T>(path: string): Promise<T | null> => {
    const response = await github(path, {}, auth).catch(() => null);
    return response?.ok ? ((await response.json()) as T) : null;
  };
  const found = await Promise.all(
    failed.slice(0, MAX_FAILURES).map(async (run) => {
      const jobId = jobIdFrom(run.details_url ?? run.html_url);
      const key = `${gh.owner}/${gh.repo}/${run.id}/${jobId}`;
      let detail = details.get(key);
      if (!detail) {
        const repoPath = `/repos/${gh.owner}/${gh.repo}`;
        // Extras for the CI row: if GitHub doesn't answer, it still says which checks failed.
        detail = Promise.all([
          jobId ? read<Job>(`${repoPath}/actions/jobs/${jobId}`) : null,
          run.id ? read<Annotation[]>(`${repoPath}/check-runs/${run.id}/annotations?per_page=50`) : null,
        ]).then(([job, annotations]) => ({ job, annotations: Array.isArray(annotations) ? annotations : [] }));
        details.set(key, detail);
        // Forget a reading that failed, so the next check tries again.
        void detail.then((d) => {
          if (jobId && !d.job) details.delete(key);
        });
      }
      return { run, ...(await detail) };
    }),
  );
  return describeFailures(found, gh.repo);
}

/** A failed job's log, cut down to the step that failed; GitHub shares logs only with signed-in users. */
export async function readFailedLog(
  repo: RepoState,
  jobId: number,
): Promise<{ name: string; text: string; errorLine: number }> {
  const gh = await githubRepo(repo);
  if (!gh) throw new Error("This repo isn't on GitHub.");
  const auth = await token(true);
  if (!auth) throw new Error("Sign in to GitHub to read CI logs: GitHub shares them only with signed-in users.");
  const repoPath = `/repos/${gh.owner}/${gh.repo}/actions/jobs/${jobId}`;
  const [jobResponse, logResponse] = await Promise.all([
    github(repoPath, {}, auth),
    github(`${repoPath}/logs`, {}, auth),
  ]);
  if (logResponse.status === 404 || logResponse.status === 410) {
    throw new Error("GitHub no longer has this log. Logs are kept for 90 days unless the repo keeps them for less.");
  }
  if (!logResponse.ok)
    throw new Error(`GitHub didn't send the log (${logResponse.status}). Try again, or open it on GitHub.`);
  const job = jobResponse.ok ? ((await jobResponse.json()) as Job) : null;
  const name = job?.name ?? "CI job";
  const step = failedStep(job);
  const jobUrl = job?.html_url ?? `https://github.com/${gh.owner}/${gh.repo}/actions/runs`;
  const url = step ? `${jobUrl}#step:${step.number}:1` : jobUrl;
  return { name, ...formatFailedLog(await logResponse.text(), { name, url }, step) };
}

/** The remote branch's name on GitHub ("origin/feat/x" → "feat/x"), or null if not pushed. */
function headBranch(repo: RepoState): string | null {
  const upstream = repo.status.upstream;
  return upstream ? upstream.slice(upstream.indexOf("/") + 1) : null;
}

/**
 * The current branch's open pull request, or that it has none yet. Null when there's nothing to
 * say: not on GitHub, not pushed, on the main branch itself, or GitHub can't be read.
 */
export async function readPullRequest(repo: RepoState): Promise<PrState | null> {
  const gh = await githubRepo(repo);
  const head = headBranch(repo);
  const base = repo.base?.name ?? null;
  if (!gh || !head || !base || head === base) return null;

  const auth = await token(false);
  let pr: PullRequest | null;
  if (auth) {
    const response = await github(
      "/graphql",
      {
        method: "POST",
        body: JSON.stringify({ query: PR_QUERY, variables: { owner: gh.owner, repo: gh.repo, head } }),
      },
      auth,
    );
    if (!response.ok) return null;
    pr = pullFromGraphql(await response.json(), gh.owner);
  } else {
    // Without a token GraphQL is unavailable; REST covers public repos, minus review threads.
    const path = `/repos/${gh.owner}/${gh.repo}/pulls`;
    const list = await github(`${path}?head=${encodeURIComponent(`${gh.owner}:${head}`)}&state=open&per_page=1`);
    if (!list.ok) return null;
    const [found] = (await list.json()) as RestPull[];
    if (found) {
      // The list leaves out mergeability; the single PR has it.
      const [single, reviews] = await Promise.all([
        github(`${path}/${found.number}`),
        github(`${path}/${found.number}/reviews?per_page=100`),
      ]);
      pr = pullFromRest(
        single.ok ? ((await single.json()) as RestPull) : found,
        reviews.ok ? ((await reviews.json()) as RestReview[]) : [],
      );
    } else pr = null;
  }
  return pr ? { kind: "open", pr, signedIn: !!auth } : { kind: "none", head, base };
}

/** Opens a pull request from the current branch's remote branch. */
export async function createPullRequest(
  repo: RepoState,
  pr: { title: string; body: string; base: string; draft: boolean },
): Promise<{ number: number; url: string }> {
  const gh = await githubRepo(repo);
  const head = headBranch(repo);
  if (!gh) throw new Error("This repo isn't on GitHub.");
  if (!head) throw new Error("Publish the branch first, then open a pull request for it.");
  const auth = await token(true);
  if (!auth) throw new Error("Sign in to GitHub to open a pull request.");
  const response = await github(
    `/repos/${gh.owner}/${gh.repo}/pulls`,
    { method: "POST", body: JSON.stringify({ ...pr, head }) },
    auth,
  );
  if (!response.ok) {
    // GitHub explains a 422 (e.g. "A pull request already exists", "No commits between...").
    const detail = (await response.json().catch(() => null)) as {
      errors?: { message?: string }[];
      message?: string;
    } | null;
    const reason = detail?.errors?.find((e) => e.message)?.message ?? detail?.message ?? `status ${response.status}`;
    throw new Error(`GitHub didn't open the pull request: ${reason.replace(/\.$/, "")}.`);
  }
  const created = (await response.json()) as RestPull;
  return { number: created.number, url: created.html_url };
}

/** GitHub's new pull request page for the current branch, with a draft filled in. */
export async function newPullRequestUrl(
  repo: RepoState,
  base: string,
  draft: { title: string; body: string },
): Promise<string | null> {
  const gh = await githubRepo(repo);
  const head = headBranch(repo);
  return gh && head ? compareUrl(gh, base, head, draft) : null;
}

export async function rerunFailedJobs(repo: RepoState, runId: number): Promise<void> {
  const gh = await githubRepo(repo);
  if (!gh) throw new Error("This repo isn't on GitHub.");
  const auth = await token(true);
  if (!auth) throw new Error("Sign in to GitHub to re-run jobs.");
  const response = await github(
    `/repos/${gh.owner}/${gh.repo}/actions/runs/${runId}/rerun-failed-jobs`,
    { method: "POST" },
    auth,
  );
  if (!response.ok) throw new Error(`GitHub refused the re-run (${response.status}).`);
}
