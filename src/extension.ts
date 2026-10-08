import * as vscode from "vscode";
import { PulseViewProvider } from "./features/pulse/PulseViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const pulse = new PulseViewProvider(context.extensionUri, context.workspaceState);

  context.subscriptions.push(
    pulse,
    vscode.window.registerWebviewViewProvider(PulseViewProvider.viewId, pulse),
    vscode.commands.registerCommand("gitkit.refresh", () => pulse.reload()),
  );
}

export function deactivate(): void {}
