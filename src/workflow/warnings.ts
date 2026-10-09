import { guardsAgainstPullRequests } from "./conditions";
import { stepsFor, template, templateKeys, type Job, type WorkflowModel } from "./model";
import { triggersYaml } from "./yaml";

// Things that are valid YAML and would run, but probably not the way you meant: shown on the job's
// card as warnings, without blocking Save.

export interface Warning {
  job: string;
  message: string;
  /** A one-click fix: the condition to give the job. */
  fix?: { label: string; condition: string };
}

/** The events a workflow runs on, however `on:` is written. */
export function workflowEvents(model: WorkflowModel): string[] {
  const on = triggersYaml(model);
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === "object" ? Object.keys(on) : [];
}

const DEPLOY_ACTIONS =
  /actions\/deploy-pages|softprops\/action-gh-release|aws-actions\/|azure\/webapps-deploy|google-github-actions\/deploy|cloudflare\/wrangler-action|peaceiris\/actions-gh-pages/;
const SENSITIVE_SCOPES = ["pages", "id-token", "packages", "deployments"];

/** Whether a job publishes or deploys something, from what it does, not just its name. */
export function deploys(job: Job): boolean {
  if (job.template !== "steps" && template(job.template).group === "ship") return true;
  const keys = { ...templateKeys(job), ...(job.extra ?? {}) };
  if (keys.environment !== undefined) return true;
  const permissions = keys.permissions;
  if (permissions && typeof permissions === "object") {
    const p = permissions as Record<string, unknown>;
    if (SENSITIVE_SCOPES.some((s) => p[s] === "write")) return true;
  }
  if (permissions === "write-all") return true;
  return stepsFor(job).some((s) => {
    if (typeof s.uses === "string" && DEPLOY_ACTIONS.test(s.uses)) return true;
    // docker/build-push-action only publishes with push: true.
    return typeof s.uses === "string" && /docker\/build-push-action/.test(s.uses) && s.with?.push === true;
  });
}

/** The branch a "run only on" fix should use: the one pushes are filtered to, else main. */
export function mainBranch(model: WorkflowModel): string {
  const on = triggersYaml(model) as Record<string, { branches?: unknown } | null> | undefined;
  const branches = on && typeof on === "object" ? on.push?.branches : undefined;
  const first = Array.isArray(branches) ? branches.find((b) => typeof b === "string" && !/[*?[]/.test(b)) : undefined;
  return typeof first === "string" ? first : "main";
}

export function warnings(model: WorkflowModel): Warning[] {
  const events = workflowEvents(model);
  const onPullRequests = events.includes("pull_request") || events.includes("pull_request_target");
  const branch = mainBranch(model);
  const found: Warning[] = [];

  for (const job of model.jobs) {
    if (onPullRequests && deploys(job) && !guardsAgainstPullRequests(job.extra?.if)) {
      found.push({
        job: job.id,
        message: `${job.name} also runs on pull requests, so every pull request would ${
          job.extra?.environment !== undefined || job.template !== "steps" ? "deploy" : "publish"
        }. Limit it to ${branch}.`,
        fix: { label: `Only run on ${branch}`, condition: `github.ref == 'refs/heads/${branch}'` },
      });
    }
    // The classic "pwn request": pull_request_target has secrets and write access, and checking out
    // the pull request's own code runs whatever a stranger put in it.
    if (events.includes("pull_request_target")) {
      const checksOutHead = stepsFor(job).some(
        (s) =>
          typeof s.uses === "string" &&
          /^actions\/checkout@/.test(s.uses) &&
          /github\.event\.pull_request\.head|github\.head_ref/.test(String(s.with?.ref ?? "")),
      );
      if (checksOutHead) {
        found.push({
          job: job.id,
          message: `${job.name} checks out the pull request's own code on pull_request_target, which has your secrets and write access. Anyone can open a pull request, so their code would run with them. Use pull_request instead, or don't run that code.`,
        });
      }
    }
  }
  return found;
}
