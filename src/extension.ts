import * as path from "node:path";
import * as vscode from "vscode";
import { STAGE_SCHEME, StageContentProvider } from "./features/conflicts/mergeEditor";
import { BranchMapPanel } from "./features/map/BranchMapPanel";
import { WorkflowStudioPanel } from "./features/workflow/WorkflowStudioPanel";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";
import { pathKey } from "./git/paths";

export function activate(context: vscode.ExtensionContext): void {
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
