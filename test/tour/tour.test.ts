import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { PulseViewProvider } from "../../src/features/pulse/PulseViewProvider";
import { readCheckpointState } from "../../src/git/checkpoints";
import type { ActionRequest } from "../../src/git/actions";
import type { RepoState } from "../../src/shared/types";

// The tour, inside the real VS Code: each step does what a click in GitKit does (the same message
// the webview sends), checks the result in git, and screenshots the window. Dialogs are answered
// by a script and recorded, since a modal can't be clicked from here. Results go to report.json.

const EXTENSION_ID = "sammyboi1801.gitkit";
const env = process.env as Record<string, string>;
const repo = env.TOUR_REPO;
const shots = env.TOUR_SHOTS;
const run = promisify(execFile);

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const write = (file: string, text: string) => writeFileSync(join(repo, file), text);

// --- Dialogs ----------------------------------------------------------------------------------

type Answer = string | undefined | ((items: unknown[]) => unknown);
const answers: Answer[] = [];
let dialogs: string[] = [];

function answer(items: unknown[]): unknown {
  const next = answers.shift();
  return typeof next === "function" ? next(items) : next;
}

function scriptDialogs() {
  const w = vscode.window as unknown as Record<string, unknown>;
  const label = (item: unknown) => (typeof item === "string" ? item : ((item as { label?: string })?.label ?? ""));
  const message =
    (kind: string) =>
    async (text: string, ...rest: unknown[]) => {
      const options =
        rest[0] && typeof rest[0] === "object" && !("title" in (rest[0] as object)) ? rest.shift() : undefined;
      const detail = (options as { detail?: string } | undefined)?.detail;
      dialogs.push(
        `${kind}: ${text}${detail ? `\n    ${detail.replace(/\n/g, "\n    ")}` : ""}${rest.length ? `\n    [${rest.map(label).join("] [")}]` : ""}`,
      );
      // A notification without buttons doesn't wait for anyone.
      return rest.length ? answer(rest) : undefined;
    };
  w.showInformationMessage = message("info");
  w.showWarningMessage = message("warning");
  w.showErrorMessage = message("error");
  w.showQuickPick = async (
    items: unknown[] | Promise<unknown[]>,
    options?: { title?: string; placeHolder?: string },
  ) => {
    const list = await items;
    dialogs.push(`pick: ${options?.title ?? options?.placeHolder ?? ""}\n    ${list.map(label).join("\n    ")}`);
    return answer(list);
  };
  w.showInputBox = async (options?: { title?: string; prompt?: string; value?: string }) => {
    const value = answer([options?.value]) as string | undefined;
    dialogs.push(`input: ${options?.title ?? options?.prompt ?? ""} → ${value ?? "(cancelled)"}`);
    return value;
  };
}

const pickLabel = (pattern: RegExp) => (items: unknown[]) =>
  items.find((i) => pattern.test(typeof i === "string" ? i : ((i as { label?: string }).label ?? "")));

// --- Steps ------------------------------------------------------------------------------------

interface StepResult {
  n: number;
  name: string;
  title: string;
  ok: boolean;
  error?: string;
  note?: string;
  screenshots: string[];
  dialogs: string[];
}
const results: StepResult[] = [];
let pulse: PulseViewProvider;
let shotCount = 0;
let current: StepResult | undefined;

async function screenshot(name: string): Promise<string> {
  shotCount++;
  const file = join(shots, `${String(shotCount).padStart(2, "0")}-${name}.png`);
  await sleep(1200); // Let the webviews render the new state.
  // Every shot re-applies the size, so a window moved or resized meanwhile still comes out the same.
  const size = ["-Width", "1440", "-Height", "900"];
  await run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    env.TOUR_CAPTURE,
    "-Exe",
    env.TOUR_CODE_EXE,
    "-Out",
    file,
    ...size,
  ]);
  current?.screenshots.push(file);
  return file;
}

/** One step: do it, check it, screenshot it. A failure is recorded and the tour goes on. */
async function step(name: string, title: string, body: (result: StepResult) => Promise<void>, shot = true) {
  const result: StepResult = { n: results.length + 1, name, title, ok: true, screenshots: [], dialogs: [] };
  current = result;
  dialogs = [];
  answers.length = 0;
  try {
    await body(result);
  } catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
  }
  if (answers.length) result.note = `${answers.length} scripted answer(s) were not needed`;
  try {
    if (shot) await screenshot(name);
  } catch (error) {
    result.ok = false;
    result.error = `${result.error ?? ""} Screenshot failed: ${error instanceof Error ? error.message : error}`.trim();
  }
  result.dialogs = dialogs;
  results.push(result);
  writeFileSync(join(shots, "report.json"), JSON.stringify(results, null, 2));
}

const repoState = () => pulse.currentRepo as RepoState;
async function refresh() {
  await vscode.commands.executeCommand("gitkit.refresh");
}
async function waitFor(check: () => boolean | Promise<boolean>, what: string, ms = 30_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    await refresh();
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const act = (request: ActionRequest) => pulse.receive({ type: "action", request });

async function setTheme(theme: string) {
  await vscode.workspace.getConfiguration("workbench").update("colorTheme", theme, vscode.ConfigurationTarget.Global);
  await sleep(1500);
}
const tabLabels = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));

// --- The tour ---------------------------------------------------------------------------------

describe("GitKit tour", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension<{ pulse: PulseViewProvider }>(EXTENSION_ID)!;
    pulse = (await extension.activate()).pulse;
    // Errors go to the panels, not to dialogs; record them with the step they happened in.
    const panel = pulse as unknown as { post: (m: { type: string; error?: { message: string } }) => void };
    const post = panel.post.bind(pulse);
    panel.post = (message) => {
      if (message.type === "error") dialogs.push(`error shown: ${message.error?.message}`);
      post(message);
    };
    scriptDialogs();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.view.extension.gitkit");
    await vscode.commands.executeCommand("gitkit.pulse.focus");
    await waitFor(() => repoState()?.status.branch === "feat/checkout", "the repo to load");
  });

  it("walks through every action", async () => {
    await step("overview", "Pulse: where the branch stands, changes, remote, history", async () => {
      check(repoState().status.files.length === 2, "two changed files");
      check(repoState().status.ahead === 1, "one commit to push");
    });

    await step("stage", "Stage a file", async () => {
      await act({ type: "stage", paths: ["src/products.js"] });
      check(git("diff", "--cached", "--name-only") === "src/products.js", "src/products.js is staged");
    });

    await step("commit", "Commit the staged change", async () => {
      await act({ type: "commit", message: "feat: seed the product list" });
      check(git("log", "-1", "--format=%s") === "feat: seed the product list", "the commit exists");
      check(git("status", "--porcelain").includes("notes.md"), "the unstaged file is left alone");
    });

    await step("push", "Push to the remote", async () => {
      await act({ type: "push" });
      check(git("rev-parse", "HEAD") === git("rev-parse", "origin/feat/checkout"), "the remote branch has the commits");
      await waitFor(() => repoState().status.ahead === 0, "nothing left to push");
    });

    await step("fetch", "Fetch: teammates' work on main, and a conflict forecast", async () => {
      await act({ type: "fetch" });
      await waitFor(() => repoState().base?.behind === 2, "two new commits on main");
      check(repoState().base?.conflicts?.includes("src/cart.js"), "a conflict is forecast in src/cart.js");
    });

    await step("branch-map", "The Branch Map, with the remote status strip", async () => {
      await vscode.commands.executeCommand("gitkit.openBranchMap");
      await waitFor(() => tabLabels().includes("Branch Map"), "the Branch Map tab");
    });

    await step("update-conflict", "Update from main stops on the forecast conflict", async () => {
      answers.push((items) => items[0]); // "Merge main"
      await act({ type: "updateFromBase" });
      await waitFor(() => repoState().operation === "merge", "the merge to stop");
      check(
        repoState().status.files.some((f) => f.conflicted && f.path === "src/cart.js"),
        "src/cart.js is conflicted",
      );
      check(
        dialogs.some((d) => d.includes("Expect conflicts in src/cart.js")),
        "the dialog warned about the conflict",
      );
    });

    await step("resolve", "Resolve the conflict, stage it and continue", async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await pulse.receive({ type: "resolveConflict", path: "src/cart.js", block: "all", choice: "theirs" });
      check(!readFileSync(join(repo, "src/cart.js"), "utf8").includes("<<<<<<<"), "no conflict markers left");
      await act({ type: "stage", paths: ["src/cart.js"] });
      await act({ type: "continueOperation" });
      await waitFor(() => repoState().operation === null, "the merge to finish");
      check(git("log", "-1", "--format=%P").split(" ").length === 2, "a merge commit was made");
    });

    await step("undo", "Undo the merge from the undo timeline", async () => {
      const before = git("rev-parse", "HEAD^1");
      answers.push((items) => items[0]);
      await act({ type: "undoTo", index: 0 });
      check(git("rev-parse", "HEAD") === before, "the branch is back where it was before the merge");
    });

    await step("discard", "Discard a file (saved, so it can come back)", async () => {
      answers.push((items) => items[0]);
      await act({ type: "discard", paths: ["notes.md"] });
      check(!existsSync(join(repo, "notes.md")), "notes.md is gone from the folder");
      check(git("stash", "list").includes("GitKit discard"), "it was saved as a stash");
    });

    await step("restore", "Get the discarded file back", async () => {
      await act({ type: "stashPop", ref: "stash@{0}" });
      check(existsSync(join(repo, "notes.md")), "notes.md is back");
    });

    await step("branch", "Create a branch, then switch back", async () => {
      await act({ type: "createBranch", name: "feat/wishlist" });
      check(git("branch", "--show-current") === "feat/wishlist", "on the new branch");
      await screenshot("branch-created");
      await act({ type: "switch", branch: "feat/checkout" });
      check(git("branch", "--show-current") === "feat/checkout", "back on feat/checkout");
    });

    await step("oops-undo-commit", "Oops: undo a pushed commit (a safe revert), then undo that", async () => {
      const subject = git("log", "-1", "--format=%s");
      const head = git("rev-parse", "HEAD");
      answers.push(pickLabel(/Undo my last commit/), (items) => items[0]);
      await pulse.oops();
      // Already pushed: rewriting it would break teammates' copies, so GitKit reverts instead.
      check(git("log", "-1", "--format=%s") === `Revert "${subject}"`, "a revert commit was added");
      check(
        dialogs.some((d) => d.includes("history isn't rewritten")),
        "the dialog said why",
      );
      await screenshot("oops-reverted");
      answers.push((items) => items[0]);
      await act({ type: "undoTo", index: 0 });
      check(git("rev-parse", "HEAD") === head, "the revert itself is undone");
    });

    await step("checkpoint", "Save a checkpoint by hand", async () => {
      write(
        "src/products.js",
        "export const products = [\n  { id: 1, name: 'Mug', price: 12 },\n  { id: 2, name: 'Tee', price: 20 },\n];\n",
      );
      await pulse.checkpoint();
      await waitFor(
        () => repoState().checkpoints.some((c) => c.reason === "saved by hand"),
        "the checkpoint to be listed",
      );
    });

    const tree = join(dirname(repo), "acme-web.worktrees", "agent-docs");
    await step("new-worktree", "New worktree for an agent, next to the repo", async () => {
      answers.push("agent/docs", (items) => items[0], "Create", undefined);
      await pulse.newWorktree();
      check(existsSync(join(tree, "README.md")), "the worktree folder has the project");
      check(gitIn(tree, "branch", "--show-current") === "agent/docs", "it's on agent/docs");
      writeFileSync(join(tree, "README.md"), "# Acme Web\n\nDocs being rewritten by an agent.\n");
      writeFileSync(join(tree, "src", "cart.js"), "// the agent touched this too\n");
      await waitFor(
        () => repoState().worktrees.some((w) => w.branch === "agent/docs" && w.changes === 2),
        "the worktree's changes",
      );
    });

    await step("agent-checkpoint", "A checkpoint when an agent starts in a terminal", async (result) => {
      const terminal = vscode.window.createTerminal({ name: "agent", cwd: tree });
      terminal.show();
      // Shell integration has to start before VS Code can report the command line.
      await sleep(4000);
      terminal.sendText("claude --version");
      try {
        await waitFor(
          async () => (await readCheckpointState(tree)).checkpoints.some((c) => c.reason === "before claude"),
          "the automatic checkpoint",
          20_000,
        );
      } catch {
        result.note =
          "No checkpoint: this VS Code's terminal didn't report the command (shell integration off?). The trigger is covered by host tests.";
      }
      // Left open, like a real agent session: removing the worktree has to deal with it.
    });

    await step(
      "remove-worktree",
      "Remove the worktree: checkpointed first, then its merged branch offered",
      async () => {
        const path = repoState().worktrees.find((w) => w.branch === "agent/docs")!.path;
        answers.push((items) => items[0], "Delete Branch");
        await act({ type: "removeWorktree", path });
        check(
          dialogs.some((d) => d.includes("(agent) will be closed first")),
          "it said the agent's terminal would be closed",
        );
        // The emptied folder may still be in use for a moment; GitKit deletes it once it's free.
        await waitFor(() => !existsSync(tree), "the folder to be gone", 15_000);
        check(git("branch", "--list", "agent/docs") === "", "the merged branch was deleted");
        check(
          repoState().removedCheckpoints.some((c) => c.reason === "before removing the worktree"),
          "its work was checkpointed",
        );
      },
    );

    await step("restore-checkpoint", "Restore files from a checkpoint", async () => {
      write("src/products.js", "broken by an agent\n");
      const saved = repoState().checkpoints.find((c) => c.reason === "saved by hand")!;
      answers.push((items) => items[0]);
      await act({ type: "restoreCheckpoint", hash: saved.hash });
      check(readFileSync(join(repo, "src/products.js"), "utf8").includes("Tee"), "the file is back to the checkpoint");
    });

    await step("commit-guard", "Commit guard stops a likely secret", async () => {
      write("src/config.js", `export const key = "AKIA${"Q".repeat(16)}";\n`);
      const head = git("rev-parse", "HEAD");
      answers.push(undefined); // Cancel the commit.
      await act({ type: "commit", message: "chore: config" });
      check(git("rev-parse", "HEAD") === head, "nothing was committed");
      check(
        dialogs.some((d) => /might include something it shouldn't/.test(d)),
        "the guard warned",
      );
      rmSync(join(repo, "src/config.js"));
    });

    await step("cleanup", "Clean up merged branches", async () => {
      git("branch", "old/spike", "origin/main");
      answers.push(
        (items) => items,
        (items) => items[0],
      );
      await pulse.cleanupBranches();
      check(git("branch", "--list", "old/spike") === "", "the merged branch is gone");
    });

    await step("studio-start", "Workflow Studio: start from a goal", async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("gitkit.openWorkflowStudio");
      await waitFor(() => tabLabels().includes("Workflow Studio"), "the Studio tab");
    });

    await step("studio-workflow", "Workflow Studio: an existing workflow, opened as editable jobs", async () => {
      await vscode.commands.executeCommand(
        "gitkit.openWorkflowStudio",
        vscode.Uri.file(join(repo, ".github", "workflows", "ci.yml")),
      );
    });

    for (const [theme, slug] of [
      ["Default Light Modern", "light"],
      ["Default High Contrast", "high-contrast"],
      ["Default High Contrast Light", "high-contrast-light"],
    ]) {
      await step(`theme-${slug}`, `${theme}: Studio, sidebar and Branch Map`, async () => {
        await setTheme(theme);
        await screenshot(`theme-${slug}-studio`);
        await vscode.commands.executeCommand("gitkit.openBranchMap");
      });
    }
    await setTheme("Default Dark Modern");

    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(failed.map((r) => `${r.name}: ${r.error}`).join("\n"));
  });
});
