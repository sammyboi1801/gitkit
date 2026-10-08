import * as vscode from "vscode";
import { STAGE_SCHEME, StageContentProvider } from "./features/conflicts/mergeEditor";
import { BranchMapPanel } from "./features/map/BranchMapPanel";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const pulse = new PulseViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    pulse,
    vscode.workspace.registerTextDocumentContentProvider(STAGE_SCHEME, new StageContentProvider()),
    vscode.window.registerWebviewViewProvider(PulseViewProvider.viewId, pulse),
    vscode.commands.registerCommand("gitkit.refresh", () => pulse.reload()),
    vscode.commands.registerCommand("gitkit.openBranchMap", () => BranchMapPanel.show(context.extensionUri, pulse)),
  );
}

export function deactivate(): void {}
