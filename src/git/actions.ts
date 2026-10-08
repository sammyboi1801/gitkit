import type { RepoState } from "../shared/types";

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
  | { type: "cherryPick"; hash: string };

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
      if (!status.branch) return fail("HEAD is detached. Check out a branch to push.");
      if (status.upstream) return ok("Push", [["push"]]);
      const remote = pickRemote(repo.remotes);
      if (!remote) return fail("No remote configured. Add one with: git remote add origin <url>");
      return ok("Publish", [["push", "-u", remote, status.branch]]);
    }

    case "pull":
      if (!status.upstream) return fail("This branch isn't tracking a remote branch yet.");
      // Fast-forward only: never creates a surprise merge commit. Diverged branches go through Sync.
      return ok("Pull", [["pull", "--ff-only"]]);

    case "sync": {
      if (!status.upstream) return planAction({ type: "push" }, repo);
      return ok("Sync", [["pull", "--rebase", "--autostash"], ["push"]]);
    }

    case "fetch":
      if (repo.remotes.length === 0) return fail("No remote configured.");
      return ok("Fetch", [["fetch", "--all", "--prune"]]);

    case "switch":
      if (request.branch === status.branch) return fail(`Already on ${request.branch}.`);
      return ok("Switch", [["switch", request.branch]]);

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
  }
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
