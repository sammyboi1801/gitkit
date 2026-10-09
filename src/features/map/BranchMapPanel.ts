import * as vscode from "vscode";
import type { PulseViewProvider } from "../pulse/PulseViewProvider";
import { renderWebviewHtml } from "../webviewHtml";

/**
 * The Branch Map: the same repo state as the Pulse sidebar, drawn as horizontal branch lanes in
 * an editor tab. All git work stays in PulseViewProvider; this panel only displays and forwards.
 */
export class BranchMapPanel {
  private static current?: BranchMapPanel;

  static show(extensionUri: vscode.Uri, provider: PulseViewProvider): void {
    if (BranchMapPanel.current) {
      BranchMapPanel.current.panel.reveal();
      return;
    }
    BranchMapPanel.current = new BranchMapPanel(extensionUri, provider);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(extensionUri: vscode.Uri, provider: PulseViewProvider) {
    const distUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel("gitkit.branchMap", "Branch Map", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [distUri],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "tab.svg");
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, distUri, "map");

    this.disposables.push(
      provider.attach(this.panel.webview),
      this.panel.webview.onDidReceiveMessage((message) => provider.receive(message)),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  private dispose(): void {
    BranchMapPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}
