import * as vscode from "vscode";
import { runGit } from "../git/runner";
import type { CiStatus, PrState, PullRequest, RepoState } from "../shared/types";
import { parseGitHubRemote, summarizeChecks, type CheckRun } from "./ci";
import { PR_QUERY, compareUrl, pullFromGraphql, pullFromRest, type RestPull, type RestReview } from "./pr";

// GitHub calls for CI status and pull requests. Public repos work without signing in; private ones use the
// GitHub account VS Code already manages, and GitKit never prompts unless the user clicks Sign in.

const API = "https://api.github.com";
const SCOPES = ["repo"];

async function token(prompt: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      SCOPES,
      prompt ? { createIfNone: true } : { silent: true },
    );
    return session?.accessToken;
  } catch {
    return undefined; // The user dismissed sign-in.
  }
}

async function github(path: string, init: RequestInit = {}, auth?: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "GitKit-VSCode",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...init.headers,
    },
  });
}

async function githubRepo(repo: RepoState): Promise<{ owner: string; repo: string } | null> {
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
  const auth = await token(prompt);
  const response = await github(`/repos/${gh.owner}/${gh.repo}/commits/${sha}/check-runs?per_page=100`, {}, auth);

  // 404 for a private repo, 403/429 when rate-limited: both fixed by signing in.
  if ((response.status === 404 || response.status === 403 || response.status === 429) && !auth) {
    return { state: "signin", sha, summary: "Sign in to GitHub to see CI", failed: [], url: actionsUrl, runId: null };
  }
  if (!response.ok) {
    return { state: "error", sha, summary: `GitHub said ${response.status}`, failed: [], url: actionsUrl, runId: null };
  }
  const body = (await response.json()) as { check_runs: CheckRun[] };
  return summarizeChecks(sha, body.check_runs ?? [], actionsUrl);
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
