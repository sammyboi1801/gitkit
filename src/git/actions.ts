import type { RepoState } from "../shared/types";
import { undoableCount } from "./history";

// Pure: the webview uses this to preview commands, the host uses it again to run them.

export type ActionRequest =
  | { type: "stage"; paths: string[] }
  | { type: "unstage"; paths: string[] }
  | { type: "discard"; paths: string[] }
  | { type: "commit"; message: string }
  | { type: "push" }
  | { type: "pull" }
  | { type: "sync" }
  | { type: "fetch" }
  | { type: "switch"; branch: string }
  | { type: "createBranch"; name: string; from?: string }
  | { type: "revert"; hash: string }
  | { type: "cherryPick"; hash: string }
  | { type: "updateFromBase" }
  | { type: "continueOperation" }
  | { type: "abortOperation" }
  | { type: "undoTo"; index: number }
  | { type: "undoLastCommit" }
  | { type: "amendMessage"; message: string }
  | { type: "amendAdd" }
  | { type: "moveToNewBranch"; name: string; keepAt: string; count: number }
  | { type: "recoverBranch"; name: string; hash: string }
  | { type: "stashApply"; ref: string }
  | { type: "stashPop"; ref: string }
  | { type: "stashDrop"; ref: string }
  | { type: "unstageAll" }
  | { type: "discardAll" }
  | { type: "untrack"; path: string }
  | { type: "deleteBranches"; names: string[] }
  | { type: "mergeBranch"; branch: string }
  | { type: "rebaseOnto"; branch: string }
  | { type: "switchAndMerge"; target: string; source: string }
  /** newBranch: create `branch` from `from` (default HEAD); otherwise check out the existing one. */
  | { type: "addWorktree"; branch: string; path: string; newBranch: boolean; from?: string }
  | { type: "removeWorktree"; path: string }
  | { type: "pruneWorktrees" }
  | { type: "lockWorktree"; path: string; reason?: string }
  | { type: "unlockWorktree"; path: string }
  | { type: "restoreCheckpoint"; hash: string };

export interface Plan {
  label: string;
  steps: string[][];
  /** Shown in a confirmation dialog before running, for anything that changes work in progress. */
  confirm?: string;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: string };

export function planAction(request: ActionRequest, repo: RepoState): PlanResult {
  const { status } = repo;

  switch (request.type) {
    case "stage":
      return ok("Stage", [["add", "--", ...request.paths]]);

    case "unstage":
      // Before the first commit there is no HEAD to restore from.
      return status.oid
        ? ok("Unstage", [["restore", "--staged", "--", ...request.paths]])
        : ok("Unstage", [["rm", "--cached", "-q", "--", ...request.paths]]);

    case "discard": {
      const names = request.paths.join(", ");
      // Stash instead of delete, so a discard can always be recovered.
      return ok(
        "Discard",
        [["stash", "push", "--include-untracked", "-m", `GitKit discard: ${names}`, "--", ...request.paths]],
        `Discard changes to ${names}? GitKit saves them as a stash, so you can get them back.`,
      );
    }

    case "commit": {
      const message = request.message.trim();
      if (!message) return fail("Write a commit message first.");
      const staged = status.files.some((f) => f.index && !f.conflicted);
      if (status.files.some((f) => f.conflicted)) return fail("Resolve the conflicts before committing.");
      if (staged) return ok("Commit", [["commit", "-m", message]]);
      if (status.files.length === 0) return fail("Nothing to commit.");
      return ok("Commit all", [
        ["add", "-A"],
        ["commit", "-m", message],
      ]);
    }

    case "push": {
      // Mid-merge, the branch is half-way between two states: pushing or pulling now only confuses it.
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      if (!status.branch) return fail("HEAD is detached. Check out a branch to push.");
      if (status.upstream) return ok("Push", [["push"]]);
      const remote = pickRemote(repo.remotes);
      if (!remote) return fail("No remote configured. Add one with: git remote add origin <url>");
      return ok("Publish", [["push", "-u", remote, status.branch]]);
    }

    case "pull":
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      if (!status.upstream) return fail("This branch isn't tracking a remote branch yet.");
      // Fast-forward only: never creates a surprise merge commit. Diverged branches go through Sync.
      return ok("Pull", [["pull", "--ff-only"]]);

    case "sync": {
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      if (!status.upstream) return planAction({ type: "push" }, repo);
      return ok("Sync", [["pull", "--rebase", "--autostash"], ["push"]]);
    }

    case "fetch":
      if (repo.remotes.length === 0) return fail("No remote configured.");
      return ok("Fetch", [["fetch", "--all", "--prune"]]);

    case "switch": {
      if (request.branch === status.branch) return fail(`Already on ${request.branch}.`);
      const elsewhere = openElsewhere(repo, request.branch);
      if (elsewhere) return fail(elsewhere);
      return ok("Switch", [["switch", request.branch]]);
    }

    case "addWorktree": {
      const branch = request.branch.trim();
      if (!isValidBranchName(branch)) return fail(`"${branch}" isn't a valid branch name.`);
      if (repo.worktrees.some((w) => w.path === request.path))
        return fail(`There's already a worktree at ${request.path}.`);
      if (request.newBranch) {
        return ok("New worktree", [["worktree", "add", "-b", branch, request.path, request.from ?? "HEAD"]]);
      }
      const elsewhere =
        openElsewhere(repo, branch) ?? (branch === status.branch ? `${branch} is open in this window.` : null);
      if (elsewhere) return fail(elsewhere);
      return ok("New worktree", [["worktree", "add", request.path, branch]]);
    }

    case "removeWorktree": {
      const w = repo.worktrees.find((t) => t.path === request.path);
      if (!w) return fail("That worktree isn't there any more.");
      if (w.main) return fail("That's the main checkout, the one the other worktrees belong to.");
      if (w.current) return fail("This window has that worktree open. Remove it from another window.");
      if (w.locked !== null) return fail(`It's locked${w.locked ? ` (${w.locked})` : ""}. Unlock it first.`);
      if (w.prunable !== null) {
        return ok("Clean up", [["worktree", "prune"]]);
      }
      const what = w.branch ? `Its branch ${w.branch} stays, with all its commits.` : "";
      if (w.changes) {
        return ok(
          "Remove worktree",
          [["worktree", "remove", "--force", w.path]],
          `Remove the worktree at ${w.path}? It has ${w.changes} uncommitted file${w.changes === 1 ? "" : "s"}, which will be deleted. ${what}`.trim(),
        );
      }
      return ok(
        "Remove worktree",
        [["worktree", "remove", w.path]],
        `Remove the worktree at ${w.path}? ${what}`.trim(),
      );
    }

    case "restoreCheckpoint": {
      const c = repo.checkpoints.find((x) => x.hash === request.hash);
      if (!c) return fail("That checkpoint isn't there any more.");
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      // --worktree only: files go back, the staging area and branch stay as they are.
      return ok(
        "Restore checkpoint",
        [["restore", "--source", c.hash, "--worktree", "--", "."]],
        `Bring this worktree's files back to the checkpoint "${c.reason}"? Files changed since are overwritten; files created since are kept. A checkpoint of how things are now is saved first, so you can undo this.`,
      );
    }

    case "pruneWorktrees":
      if (!repo.worktrees.some((w) => w.prunable !== null)) return fail("No worktrees have gone missing.");
      return ok("Clean up", [["worktree", "prune"]]);

    case "lockWorktree": {
      const w = repo.worktrees.find((t) => t.path === request.path);
      if (!w || w.main) return fail("Only an added worktree can be locked.");
      if (w.locked !== null) return fail("It's already locked.");
      const reason = request.reason?.trim();
      return ok("Lock", [["worktree", "lock", ...(reason ? ["--reason", reason] : []), w.path]]);
    }

    case "unlockWorktree": {
      const w = repo.worktrees.find((t) => t.path === request.path);
      if (!w || w.locked === null) return fail("It isn't locked.");
      return ok("Unlock", [["worktree", "unlock", w.path]]);
    }

    case "createBranch": {
      const name = request.name.trim();
      if (!isValidBranchName(name)) return fail(`"${name}" isn't a valid branch name.`);
      return ok("Create branch", [["switch", "-c", name, ...(request.from ? [request.from] : [])]]);
    }

    case "revert": {
      if (hasTrackedChanges(repo)) return fail("Commit or stash your changes before reverting.");
      return ok(
        "Revert",
        [["revert", "--no-edit", request.hash]],
        `Revert ${request.hash.slice(0, 7)}? This adds a new commit that undoes it; history isn't rewritten.`,
      );
    }

    case "cherryPick": {
      if (!status.branch) return fail("HEAD is detached. Check out a branch first.");
      if (hasTrackedChanges(repo)) return fail("Commit or stash your changes before cherry-picking.");
      return ok(
        "Cherry-pick",
        [["cherry-pick", request.hash]],
        `Copy commit ${request.hash.slice(0, 7)} onto ${status.branch}?`,
      );
    }

    case "updateFromBase":
      return planUpdateFromBase(repo);

    case "continueOperation": {
      const op = repo.operation;
      if (!op) return fail("Nothing is in progress.");
      const unresolved = status.files.filter((f) => f.conflicted).length;
      if (unresolved)
        return fail(`Resolve and stage ${unresolved} conflicted file${unresolved === 1 ? "" : "s"} first.`);
      // core.editor=true accepts git's prepared message instead of opening an editor nobody can see.
      if (op === "merge") return ok("Continue", [["commit", "--no-edit"]]);
      return ok("Continue", [["-c", "core.editor=true", op, "--continue"]]);
    }

    case "undoTo":
      return planUndo(request.index, repo);

    case "undoLastCommit": {
      if (!status.oid) return fail("There's no commit to undo yet.");
      if (!headIsUnpushed(repo))
        return fail("The last commit is already pushed. Revert it instead, so nobody's history breaks.");
      const head = repo.graph.commits.find((c) => c.hash === status.oid);
      if (!head?.parents.length) return fail("This is the first commit; there's nothing before it.");
      return ok(
        "Undo commit",
        [["reset", "--soft", "HEAD~1"]],
        `Undo "${head.subject}"? The commit goes away but all its changes stay staged, ready to commit again.`,
      );
    }

    case "amendMessage": {
      const message = request.message.trim();
      if (!message) return fail("Write the new message first.");
      if (!headIsUnpushed(repo))
        return fail("The last commit is already pushed; changing it would rewrite shared history.");
      // --only with no paths changes just the message, even if other changes are staged.
      // --allow-empty: rewording an empty commit (e.g. "trigger CI") must not fail.
      return ok("Reword", [["commit", "--amend", "--only", "--allow-empty", "-m", message]]);
    }

    case "amendAdd":
      if (!headIsUnpushed(repo))
        return fail("The last commit is already pushed; changing it would rewrite shared history.");
      if (status.files.length === 0) return fail("There are no changes to add.");
      return ok("Add to last commit", [
        ["add", "-A"],
        ["commit", "--amend", "--no-edit"],
      ]);

    case "moveToNewBranch": {
      const name = request.name.trim();
      if (!status.branch) return fail("HEAD is detached. Check out a branch first.");
      if (!isValidBranchName(name)) return fail(`"${name}" isn't a valid branch name.`);
      const n = `${request.count} commit${request.count === 1 ? "" : "s"}`;
      return ok(
        "Move commits",
        [
          ["branch", name],
          ["reset", "--keep", request.keepAt],
          ["switch", name],
        ],
        `Move your last ${n} from ${status.branch} to a new branch "${name}"? ${status.branch} goes back to ${request.keepAt.slice(0, 7)}; uncommitted changes come with you.`,
      );
    }

    case "recoverBranch":
      if (!isValidBranchName(request.name)) return fail(`"${request.name}" isn't a valid branch name.`);
      return ok("Recover branch", [["branch", request.name, request.hash]]);

    case "stashApply":
      return ok("Restore", [["stash", "apply", request.ref]]);

    case "stashPop":
      return ok("Restore and remove", [["stash", "pop", request.ref]]);

    case "stashDrop":
      return ok(
        "Delete stash",
        [["stash", "drop", request.ref]],
        `Delete ${request.ref} for good? Unlike discards, this can't be undone from GitKit.`,
      );

    case "unstageAll":
      if (!status.files.some((f) => f.index)) return fail("Nothing is staged.");
      return status.oid
        ? ok("Unstage all", [["restore", "--staged", "."]])
        : ok("Unstage all", [["rm", "--cached", "-r", "-q", "."]]);

    case "discardAll":
      if (status.files.length === 0) return fail("There are no changes to discard.");
      return ok(
        "Discard all",
        [["stash", "push", "--include-untracked", "-m", "GitKit discard: all changes"]],
        `Throw away all ${status.files.length} changed files? GitKit saves them as a stash, so you can get them back.`,
      );

    case "untrack":
      return ok(
        "Stop tracking",
        [["rm", "--cached", "-q", "--", request.path]],
        `Stop tracking ${request.path}? The file stays on your disk; the next commit removes it from the repo.`,
      );

    case "deleteBranches": {
      if (request.names.length === 0) return fail("Pick at least one branch.");
      if (status.branch && request.names.includes(status.branch)) return fail("You can't delete the branch you're on.");
      // Git refuses to delete a branch another worktree has checked out.
      const open = repo.worktrees.find((w) => w.branch && request.names.includes(w.branch));
      if (open) return fail(`${open.branch} is open in a worktree (${open.path}). Remove that worktree first.`);
      // -D: these were already checked as merged, gone or squash-merged; plain -d misses squash merges.
      return ok(
        "Delete branches",
        [["branch", "-D", ...request.names]],
        `Delete ${request.names.length} local branch${request.names.length === 1 ? "" : "es"}: ${request.names.join(", ")}? Recover them later from Oops → Recover a deleted branch.`,
      );
    }

    case "mergeBranch": {
      if (!status.branch) return fail("HEAD is detached. Check out a branch to merge into.");
      if (request.branch === status.branch) return fail("A branch can't be merged into itself.");
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      return ok(
        `Merge into ${status.branch}`,
        [["merge", "--autostash", "--no-edit", request.branch]],
        `Merge ${request.branch} into ${status.branch}?`,
      );
    }

    case "rebaseOnto": {
      if (!status.branch) return fail("HEAD is detached. Check out a branch to rebase.");
      if (request.branch === status.branch) return fail("A branch can't be rebased onto itself.");
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      const published = status.upstream ? " It's already published, so you'll need to force-push afterwards." : "";
      return ok(
        "Rebase",
        [
          ["update-ref", `refs/gitkit/backup/${status.branch}`, "HEAD"],
          ["rebase", "--autostash", request.branch],
        ],
        `Replay ${status.branch}'s commits on top of ${request.branch}?${published} A backup is saved first.`,
      );
    }

    case "switchAndMerge": {
      if (request.target === request.source) return fail("A branch can't be merged into itself.");
      if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
      if (request.target === status.branch) return planAction({ type: "mergeBranch", branch: request.source }, repo);
      const elsewhere = openElsewhere(repo, request.target);
      if (elsewhere) return fail(elsewhere);
      return ok(
        `Merge into ${request.target}`,
        [
          ["switch", request.target],
          ["merge", "--autostash", "--no-edit", request.source],
        ],
        `Switch to ${request.target} and merge ${request.source} into it?`,
      );
    }

    case "abortOperation": {
      const op = repo.operation;
      if (!op) return fail("Nothing is in progress.");
      return ok(
        "Abort",
        [[op, "--abort"]],
        `Abort the ${op}? Your branch goes back to exactly how it was before it started.`,
      );
    }
  }
}

/**
 * Why a branch can't be checked out here because another worktree has it, or null. Git refuses
 * that with an error; saying where it's open lets the user go there instead.
 */
function openElsewhere(repo: RepoState, branch: string): string | null {
  const w = repo.worktrees.find((t) => t.branch === branch && !t.current);
  return w ? `${branch} is open in another worktree (${w.path}). Open that worktree instead.` : null;
}

function headIsUnpushed(repo: RepoState): boolean {
  // With no remote at all, nothing is shared, so everything counts as unpushed.
  return repo.remotes.length === 0 || (!!repo.status.oid && repo.unpushed.includes(repo.status.oid));
}

/** Goes back to just before history entry `index`, which also undoes every newer entry. */
function planUndo(index: number, repo: RepoState): PlanResult {
  const entry = repo.history[index];
  if (!entry) return fail("That step isn't in the history any more.");
  if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
  if (index >= undoableCount(repo.history)) return fail("That happened on another branch. Switch to it first.");

  if (entry.kind === "checkout") {
    if (!entry.from) return fail("Couldn't tell which branch this switched from.");
    const newer = index > 0 ? ` Commits made on ${entry.to} since then stay there.` : "";
    return ok("Switch back", [["switch", entry.from]], `Switch back to ${entry.from}?${newer}`);
  }

  if (!entry.before) return fail("There's nothing before this step.");
  const alsoNewer = index > 0 ? ` This also undoes the ${index} newer step${index === 1 ? "" : "s"} above it.` : "";
  const pushed = headIsUnpushed(repo) ? "" : " Some of this is already pushed, so you'd need to force-push afterwards.";
  return ok(
    "Undo",
    [["reset", "--keep", entry.before]],
    `Go back to before: ${entry.summary}? The branch moves to ${entry.before.slice(0, 7)}.${alsoNewer}${pushed} Uncommitted changes are kept, and you can redo this from the same list.`,
  );
}

function planUpdateFromBase(repo: RepoState): PlanResult {
  const { status, base } = repo;
  if (!base) return fail("No main branch found to update from.");
  if (base.isCurrent) return planAction({ type: "pull" }, repo);
  if (!status.branch || !status.oid) return fail("Check out a branch first.");
  if (repo.operation) return fail(`Finish or abort the ${repo.operation} first.`);
  if (base.behind === 0) return fail(`Already up to date with ${base.name}.`);

  const backup = ["update-ref", `refs/gitkit/backup/${status.branch}`, "HEAD"];
  const n = `${base.behind} new commit${base.behind === 1 ? "" : "s"}`;
  const conflictNote = base.conflicts?.length
    ? ` Expect conflicts in ${base.conflicts.join(", ")}: you'll resolve them here, or abort to undo.`
    : "";
  const backupNote = ` A backup of ${status.branch} is saved first.`;

  // Rebasing rewrites commits, which is only safe while nobody else has them. Once published, merge.
  if (status.upstream) {
    return ok(
      `Merge ${base.name}`,
      [backup, ["merge", "--autostash", "--no-edit", base.ref]],
      `Bring ${n} from ${base.name} into ${status.branch}? Your branch is published, so GitKit merges instead of rewriting its history.${conflictNote}${backupNote}`,
    );
  }
  return ok(
    `Rebase on ${base.name}`,
    [backup, ["rebase", "--autostash", base.ref]],
    `Replay your ${base.ahead} commit${base.ahead === 1 ? "" : "s"} on top of ${n} from ${base.name}? Your branch isn't published yet, so this keeps history linear.${conflictNote}${backupNote}`,
  );
}

// A practical subset of git check-ref-format: enough to catch typos before git does.
export function isValidBranchName(name: string): boolean {
  if (!name || name === "@") return false;
  return !/[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|[/.]$|\.lock$/.test(name);
}

function hasTrackedChanges(repo: RepoState): boolean {
  return repo.status.files.some((f) => !f.untracked);
}

function pickRemote(remotes: readonly string[]): string | undefined {
  return remotes.includes("origin") ? "origin" : remotes[0];
}

function ok(label: string, steps: string[][], confirm?: string): PlanResult {
  return { ok: true, plan: { label, steps, confirm } };
}

function fail(reason: string): PlanResult {
  return { ok: false, reason };
}
