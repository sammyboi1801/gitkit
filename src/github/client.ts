import * as vscode from "vscode";
import { runGit } from "../git/runner";
import type { CiStatus, RepoState } from "../shared/types";
import { parseGitHubRemote, summarizeChecks, type CheckRun } from "./ci";

// GitHub REST calls for CI status. Public repos work without signing in; private ones use the
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
