import * as vscode from "vscode";
import { STAGE_SCHEME, StageContentProvider } from "./features/conflicts/mergeEditor";
import { BranchMapPanel } from "./features/map/BranchMapPanel";
import { WorkflowStudioPanel } from "./features/workflow/WorkflowStudioPanel";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const pulse = new PulseViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    pulse,
    vscode.workspace.registerTextDocumentContentProvider(STAGE_SCHEME, new StageContentProvider()),
    vscode.window.registerWebviewViewProvider(PulseViewProvider.viewId, pulse),
    vscode.commands.registerCommand("gitkit.refresh", () => pulse.reload()),
    vscode.commands.registerCommand("gitkit.openBranchMap", () => BranchMapPanel.show(context.extensionUri, pulse)),
    vscode.commands.registerCommand("gitkit.oops", () => pulse.oops()),
    vscode.commands.registerCommand("gitkit.openWorkflowStudio", () => {
      const repo = pulse.currentRepo;
      WorkflowStudioPanel.show(context.extensionUri, repo && { root: repo.root, baseName: repo.base?.name ?? null });
    }),
    vscode.commands.registerCommand("gitkit.cleanupBranches", () => pulse.cleanupBranches()),
  );
}

export function deactivate(): void {}
