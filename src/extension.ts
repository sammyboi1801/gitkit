import * as vscode from "vscode";
import { BranchMapPanel } from "./features/map/BranchMapPanel";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const pulse = new PulseViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    pulse,
    vscode.window.registerWebviewViewProvider(PulseViewProvider.viewId, pulse),
    vscode.commands.registerCommand("gitkit.refresh", () => pulse.reload()),
    vscode.commands.registerCommand("gitkit.openBranchMap", () => BranchMapPanel.show(context.extensionUri, pulse)),
  );
}

export function deactivate(): void {}
