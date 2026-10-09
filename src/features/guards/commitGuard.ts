import { realpathSync } from "node:fs";
import { appendFile, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Plan } from "../../git/actions";
import {
  addedLines,
  checkFiles,
  matchIdentity,
  scanForSecrets,
  type GuardIssue,
  type IdentityRule,
} from "../../git/guard";
import { runGit } from "../../git/runner";
import type { RepoState } from "../../shared/types";

const MAX_SCAN_BYTES = 1024 * 1024;

/**
 * Runs before a commit. Returns the steps to run (possibly adjusted to leave files out),
 * or undefined if the user cancelled.
 */
export async function guardCommit(repo: RepoState, plan: Plan): Promise<string[][] | undefined> {
  const config = vscode.workspace.getConfiguration("gitkit");
  let steps = plan.steps;

  if (config.get<boolean>("commitGuard.enabled", true)) {
    const result = await checkContent(repo, plan, config.get<number>("commitGuard.maxFileSizeMB", 10));
    if (!result) return undefined;
    steps = result;
  }

  const rules = config.get<IdentityRule[]>("identities", []);
  if (rules.length && !(await checkIdentity(repo, rules))) return undefined;
  return steps;
}

async function checkContent(repo: RepoState, plan: Plan, maxMB: number): Promise<string[][] | undefined> {
  const commitAll = plan.steps[0]?.[0] === "add";
  const files = repo.status.files.filter((f) => (commitAll ? true : f.index) && f.worktree !== "D" && f.index !== "D");

  const sized = await Promise.all(
    files.map(async (f) => ({
      path: f.path,
      size: await stat(path.join(repo.root, f.path)).then(
        (s) => s.size,
        () => 0,
      ),
    })),
  );

  // Only scan what this commit adds, so secrets already in history don't nag on every commit.
  const diffArgs = commitAll && repo.status.oid ? ["diff", "HEAD"] : ["diff", "--cached"];
  const diff = await runGit([...diffArgs, "-U0", "--no-color", "--no-ext-diff"], repo.root).then(
    (r) => r.stdout,
    () => "",
  );
  const added = addedLines(diff);
  if (commitAll) {
    // New files aren't in `git diff HEAD`; read them directly.
    for (const f of sized.filter((s) => repo.status.files.find((x) => x.path === s.path)?.untracked)) {
      if (f.size > MAX_SCAN_BYTES) continue;
      const text = await readFile(path.join(repo.root, f.path), "utf8").catch(() => "");
      added.set(
        f.path,
        text.split(/\r?\n/).map((line, i) => ({ line: i + 1, text: line })),
      );
    }
  }

  const issues = [...checkFiles(sized, maxMB * 1024 * 1024), ...scanForSecrets(added)];
  if (issues.length === 0) return plan.steps;

  const removable = [...new Set(issues.filter((i) => i.kind !== "secret").map((i) => i.path))];
  const secret = issues.find((i) => i.kind === "secret");
  const buttons = ["Commit Anyway", ...(removable.length ? ["Leave Those Out"] : []), ...(secret ? ["Show Me"] : [])];
  const choice = await vscode.window.showWarningMessage(
    `This commit might include something it shouldn't (${issues.length} finding${issues.length === 1 ? "" : "s"}).`,
    { modal: true, detail: issues.map(describe).join("\n") },
    ...buttons,
  );

  if (choice === "Commit Anyway") return plan.steps;
  if (choice === "Show Me" && secret) {
    const document = await vscode.workspace.openTextDocument(path.join(repo.root, secret.path));
    const line = Math.max(0, (secret.line ?? 1) - 1);
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(line, 0, line, 0) });
    return undefined;
  }
  if (choice === "Leave Those Out") return leaveOut(repo, plan, removable);
  return undefined;
}

function describe(issue: GuardIssue): string {
  return `• ${issue.path}${issue.line ? `:${issue.line}` : ""} ${issue.detail}`;
}

/** Keeps the flagged files out of this commit and out of future ones (.gitignore for new files). */
async function leaveOut(repo: RepoState, plan: Plan, paths: string[]): Promise<string[][]> {
  const file = (p: string) => repo.status.files.find((f) => f.path === p);
  // New files (untracked, or staged but never committed) get ignored, which keeps them out of
  // this and every later commit. Files git already tracks can't be ignored that way.
  const newFiles = paths.filter((p) => file(p)?.untracked || file(p)?.index === "A");
  const tracked = paths.filter((p) => !newFiles.includes(p));
  if (newFiles.length) await appendIgnores(repo.root, newFiles);

  const staged = paths.filter((p) => file(p)?.index);
  const unstage = staged.length ? [["restore", "--staged", "--", ...staged]] : [];
  // For "commit all", keep tracked files out of the add with exclude pathspecs. Newly ignored
  // files must not be named: git refuses an add that mentions an ignored path, even to exclude it.
  const steps = plan.steps.map((args) =>
    args[0] === "add" && args[1] === "-A" && tracked.length
      ? ["add", "-A", "--", ".", ...tracked.map((p) => `:(exclude)${p}`)]
      : args,
  );
  return [...unstage, ...steps];
}

async function appendIgnores(root: string, files: string[]): Promise<void> {
  const gitignore = path.join(root, ".gitignore");
  const current = await readFile(gitignore, "utf8").catch(() => "");
  const existing = new Set(current.split(/\r?\n/));
  const entries = files.map((f) => "/" + f.replace(/\\/g, "/")).filter((e) => !existing.has(e));
  if (entries.length === 0) return;
  await appendFile(gitignore, `${current && !current.endsWith("\n") ? "\n" : ""}${entries.join("\n")}\n`);
}

/** Warns when this repo is set up to expect a different email than the one commits would use. */
async function checkIdentity(repo: RepoState, rules: IdentityRule[]): Promise<boolean> {
  const remote = repo.remotes.includes("origin") ? "origin" : repo.remotes[0];
  const [email, url] = await Promise.all([
    runGit(["config", "user.email"], repo.root).then(
      (r) => r.stdout.trim(),
      () => "",
    ),
    remote
      ? runGit(["remote", "get-url", remote], repo.root).then(
          (r) => r.stdout.trim(),
          () => null,
        )
      : null,
  ]);
  // Compare real, full paths: Windows can report the same folder by its short 8.3 name
  // (C:\Users\RUNNER~1\...) in one place and its long name in another.
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const resolved = rules.map((r) => (r.folder ? { ...r, folder: real(r.folder) } : r));
  const rule = matchIdentity(resolved, url, real(repo.root));
  if (!rule || rule.email.toLowerCase() === email.toLowerCase()) return true;

  const use = `Use ${rule.email} Here`;
  const keep = `Commit as ${email || "(no email)"}`;
  const choice = await vscode.window.showWarningMessage(
    `This repo should use ${rule.email}, but this commit would be made as ${email || "nobody (no email set)"}.`,
    { modal: true, detail: "Choosing the expected email sets it for this repository only (git config, not --global)." },
    use,
    keep,
  );
  if (choice === keep) return true;
  if (choice !== use) return false;
  await runGit(["config", "user.email", rule.email], repo.root);
  if (rule.name) await runGit(["config", "user.name", rule.name], repo.root);
  return true;
}
