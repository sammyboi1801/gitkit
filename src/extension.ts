import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { STAGE_SCHEME, StageContentProvider } from "./features/conflicts/mergeEditor";
import { BranchMapPanel } from "./features/map/BranchMapPanel";
import { WorkflowStudioPanel } from "./features/workflow/WorkflowStudioPanel";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";
import { pathKey } from "./git/paths";
import { runGit } from "./git/runner";
import { gitVersionProblem } from "./git/version";

/**
 * Returns the sidebar provider so the end-to-end tour (scripts/tour.mjs) can drive actions the way
 * the webview does. It isn't a public API for other extensions.
 */
export function activate(context: vscode.ExtensionContext): { pulse: PulseViewProvider } {
  const pulse = new PulseViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    pulse,
    vscode.workspace.registerTextDocumentContentProvider(STAGE_SCHEME, new StageContentProvider()),
    vscode.window.registerWebviewViewProvider(PulseViewProvider.viewId, pulse),
    vscode.commands.registerCommand("gitkit.refresh", () => pulse.reload()),
    vscode.commands.registerCommand("gitkit.openBranchMap", () => BranchMapPanel.show(context.extensionUri, pulse)),
    vscode.commands.registerCommand("gitkit.oops", () => pulse.oops()),
    vscode.commands.registerCommand("gitkit.openWorkflowStudio", (file?: vscode.Uri) => {
      const repo = pulse.currentRepo;
      // From a workflow file's menu: open Studio on that file, in the repo it belongs to.
      const workflow = file && workflowFile(file.fsPath);
      if (workflow) {
        const sameRepo = repo && pathKey(repo.root) === pathKey(workflow.root);
        return WorkflowStudioPanel.show(
          context.extensionUri,
          { root: workflow.root, baseName: sameRepo ? (repo.base?.name ?? null) : null },
          workflow.name,
        );
      }
      return WorkflowStudioPanel.show(
        context.extensionUri,
        repo && { root: repo.root, baseName: repo.base?.name ?? null },
      );
    }),
    vscode.commands.registerCommand("gitkit.cleanupBranches", () => pulse.cleanupBranches()),
    vscode.commands.registerCommand("gitkit.newWorktree", () => pulse.newWorktree()),
    vscode.commands.registerCommand("gitkit.checkpoint", () => pulse.checkpoint()),
  );
  void warnAboutGit();
  return { pulse };
}

/** Once at start-up: a git too old for some features, or none at all, is said plainly. */
export async function warnAboutGit(
  version: () => Promise<string> = async () => (await runGit(["version"], os.homedir())).stdout,
): Promise<void> {
  let output: string;
  try {
    output = await version();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `GitKit couldn't run git (${detail}). Install git from git-scm.com, or add it to your PATH, then restart VS Code.`,
    );
    return;
  }
  const problem = gitVersionProblem(output);
  if (problem) void vscode.window.showWarningMessage(problem);
}

export function deactivate(): void {}

/** <repo>/.github/workflows/<name>.yml → the repo and the file's name; null for any other file. */
export function workflowFile(file: string): { root: string; name: string } | null {
  const parts = file.split(/[\\/]/);
  const n = parts.length;
  if (n < 4 || !/\.ya?ml$/i.test(parts[n - 1]) || parts[n - 2] !== "workflows" || parts[n - 3] !== ".github")
    return null;
  return { root: parts.slice(0, n - 3).join(path.sep) || path.sep, name: parts[n - 1] };
}
