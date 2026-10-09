import { appendFile, readFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { isValidBranchName, planAction, type ActionRequest } from "../../git/actions";
import { formatCommand } from "../../git/format";
import { deletedBranches, undoableCount } from "../../git/history";
import { readBranches, readCleanupCandidates, readTrackedFiles } from "../../git/repo";
import type { RepoState } from "../../shared/types";

// "Oops": the git mistakes everyone googles, as plain-English choices. Each returns an action
// request; the caller plans it again, confirms where needed and runs it, like any other action.

type Item = vscode.QuickPickItem & { run?: () => Promise<ActionRequest | undefined> };

export async function pickOops(repo: RepoState): Promise<ActionRequest | undefined> {
  const items = await buildItems(repo);
  const choice = await vscode.window.showQuickPick(items, {
    title: "Oops: fix a mistake",
    placeHolder: "What happened?",
    matchOnDescription: true,
  });
  return choice?.run?.();
}

/** The command an option would run, as the item's description, or why it can't run right now. */
function describe(request: ActionRequest, repo: RepoState): { description: string; enabled: boolean } {
  const result = planAction(request, repo);
  return result.ok
    ? { description: result.plan.steps.map(formatCommand).join(" && "), enabled: true }
    : { description: result.reason, enabled: false };
}

async function buildItems(repo: RepoState): Promise<Item[]> {
  const { status } = repo;
  const head = repo.graph.commits.find((c) => c.hash === status.oid);
  const pushed = repo.remotes.length > 0 && !!status.oid && !repo.unpushed.includes(status.oid);
  const items: Item[] = [];

  if (head && head.parents.length) {
    if (pushed) {
      const revert = describe({ type: "revert", hash: head.hash }, repo);
      items.push({
        label: "$(discard) Undo my last commit",
        description: revert.description,
        detail: `"${head.subject}" is already pushed, so GitKit adds a new commit that undoes it.`,
        run: async () => ({ type: "revert", hash: head.hash }),
      });
    } else {
      items.push({
        label: "$(discard) Undo my last commit (keep the changes)",
        description: describe({ type: "undoLastCommit" }, repo).description,
        detail: `"${head.subject}" goes away; its changes stay staged.`,
        run: async () => ({ type: "undoLastCommit" }),
      });
      items.push({
        label: "$(edit) Change the last commit's message",
        description: "git commit --amend --only -m …",
        run: async () => {
          const message = await vscode.window.showInputBox({ title: "New commit message", value: head.subject });
          return message ? { type: "amendMessage", message } : undefined;
        },
      });
      if (status.files.length) {
        items.push({
          label: "$(add) Add my current changes to the last commit",
          description: describe({ type: "amendAdd" }, repo).description,
          detail: "For the file you forgot, or the typo you just fixed.",
          run: async () => ({ type: "amendAdd" }),
        });
      }
    }
  }

  const unpushedOnBranch = repo.graph.commits.filter((c) => repo.unpushed.includes(c.hash));
  if (status.branch && unpushedOnBranch.length) {
    items.push({
      label: "$(git-branch) I committed to the wrong branch",
      description: "move commits to a new branch",
      detail: `Moves unpushed commits off ${status.branch} onto a new branch.`,
      run: () => moveToNewBranch(unpushedOnBranch),
    });
  }

  const existing = new Set((await readBranches(repo.root).catch(() => [])).map((b) => b.name));
  const lost = deletedBranches(repo.history, existing);
  if (lost.length) {
    items.push({
      label: "$(history) Recover a deleted branch",
      description: lost.map((b) => b.name).join(", "),
      run: async () => {
        const pick = await vscode.window.showQuickPick(
          lost.map((b) => ({ label: b.name, description: `last at ${b.hash.slice(0, 7)}`, branch: b })),
          { title: "Recover which branch?" },
        );
        return pick ? { type: "recoverBranch", name: pick.branch.name, hash: pick.branch.hash } : undefined;
      },
    });
  }

  if (repo.stashes.length) {
    items.push({
      label: "$(archive) Get back changes I discarded or stashed",
      description: `${repo.stashes.length} saved`,
      run: async () => {
        const pick = await vscode.window.showQuickPick(
          repo.stashes.map((s) => ({
            label: s.message,
            description: [s.branch && `on ${s.branch}`, s.ref].filter(Boolean).join(" · "),
            stash: s,
          })),
          { title: "Restore which one? (a copy stays saved)" },
        );
        return pick ? { type: "stashApply", ref: pick.stash.ref } : undefined;
      },
    });
  }

  if (status.files.some((f) => f.index)) {
    items.push({ label: "$(remove) Unstage everything", ...withDescription({ type: "unstageAll" }, repo) });
  }
  if (status.files.length) {
    items.push({
      label: "$(trash) Throw away all my changes",
      ...withDescription({ type: "discardAll" }, repo),
      detail: "Saved as a stash first, so this is recoverable.",
    });
  }

  items.push({
    label: "$(eye-closed) Stop tracking a file (keep it on disk)",
    description: "for .env files, build output, big files committed by mistake",
    run: () => untrack(repo),
  });

  if (repo.base) {
    const base = repo.base;
    items.push({
      label: "$(trash) Clean up branches that are already merged",
      description: `including squash-merged into ${base.name}`,
      run: () => pickCleanup(repo, base.ref, base.name),
    });
  }

  if (repo.history.length) {
    items.push({
      label: "$(arrow-left) Go back in time…",
      description: "undo recent steps: commits, merges, rebases, resets",
      run: () => pickUndo(repo),
    });
  }

  return items;
}

function withDescription(request: ActionRequest, repo: RepoState): Pick<Item, "description" | "run"> {
  return { description: describe(request, repo).description, run: async () => request };
}

async function moveToNewBranch(unpushed: RepoState["graph"]["commits"]) {
  const pick = await vscode.window.showQuickPick(
    unpushed.map((c, i) => ({
      label: c.subject,
      description: `${c.hash.slice(0, 7)} · moves ${i + 1} commit${i === 0 ? "" : "s"}`,
      index: i,
    })),
    { title: "Move this commit and everything newer", placeHolder: "Pick the oldest commit to move" },
  );
  if (!pick) return undefined;
  const oldest = unpushed[pick.index];
  const keepAt = oldest.parents[0];
  if (!keepAt) return undefined;
  const name = await vscode.window.showInputBox({
    title: "Name for the new branch",
    placeHolder: "feat/my-change",
    validateInput: (v) => (!v.trim() || isValidBranchName(v.trim()) ? undefined : "Not a valid branch name"),
  });
  return name ? ({ type: "moveToNewBranch", name, keepAt, count: pick.index + 1 } as const) : undefined;
}

async function untrack(repo: RepoState): Promise<ActionRequest | undefined> {
  const files = await readTrackedFiles(repo.root);
  const file = await vscode.window.showQuickPick(files, {
    title: "Stop tracking which file?",
    placeHolder: "Type to filter",
  });
  if (!file) return undefined;
  const ignore = await vscode.window.showQuickPick(
    [
      { label: "Yes, add it to .gitignore", add: true },
      { label: "No, just stop tracking it", add: false },
    ],
    { title: `Also ignore ${file} from now on?` },
  );
  if (!ignore) return undefined;
  if (ignore.add) await addToGitignore(repo.root, file);
  return { type: "untrack", path: file };
}

async function addToGitignore(root: string, file: string): Promise<void> {
  const gitignore = path.join(root, ".gitignore");
  const current = await readFile(gitignore, "utf8").catch(() => "");
  const entry = "/" + file.replace(/\\/g, "/");
  if (current.split(/\r?\n/).includes(entry)) return;
  await appendFile(gitignore, `${current && !current.endsWith("\n") ? "\n" : ""}${entry}\n`);
}

export async function pickCleanup(repo: RepoState, baseRef: string, baseName: string) {
  // A branch some worktree has checked out can't be deleted; it's cleaned up with its worktree.
  const inWorktrees = new Set(repo.worktrees.map((w) => w.branch));
  const candidates = (
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Checking which branches are merged…" },
      () => readCleanupCandidates(repo.root, baseRef, baseName),
    )
  ).filter((c) => !inWorktrees.has(c.branch.name));
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage("No merged branches to clean up.");
    return undefined;
  }
  const picks = await vscode.window.showQuickPick(
    candidates.map((c) => ({ label: c.branch.name, description: c.reason, detail: c.branch.subject, picked: true })),
    { title: "Delete these branches?", canPickMany: true },
  );
  return picks?.length ? ({ type: "deleteBranches", names: picks.map((p) => p.label) } as const) : undefined;
}

async function pickUndo(repo: RepoState): Promise<ActionRequest | undefined> {
  const limit = undoableCount(repo.history);
  const pick = await vscode.window.showQuickPick(
    repo.history.slice(0, limit).map((entry, index) => ({
      label: entry.summary,
      description: new Date(entry.time * 1000).toLocaleString(),
      detail: index === 0 ? "Undo just this" : `Undo this and the ${index} newer step${index === 1 ? "" : "s"} above`,
      index,
    })),
    { title: "Go back to before…" },
  );
  return pick ? { type: "undoTo", index: pick.index } : undefined;
}
