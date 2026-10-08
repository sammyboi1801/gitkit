import * as vscode from "vscode";
import { GitError, formatCommand, runGit } from "../../git/runner";
import type { HostToWebview, PulseState, WebviewToHost } from "../../shared/messages";

export class PulseViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "gitkit.pulse";

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");

    view.webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    view.webview.html = renderHtml(view.webview, distUri);

    view.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (message.type === "ready" || message.type === "refresh") {
        void this.refresh();
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    this.post({ type: "state", state: { kind: "loading" } });
    this.post({ type: "state", state: await readState() });
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }
}

async function readState(): Promise<PulseState> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return { kind: "no-folder" };

  const args = ["rev-parse", "--abbrev-ref", "HEAD"];
  try {
    const { stdout } = await runGit(args, folder);
    return { kind: "repo", folder, branch: stdout.trim(), command: formatCommand(args) };
  } catch (error) {
    if (error instanceof GitError && /not a git repository/i.test(error.stderr)) {
      return { kind: "no-repo", folder };
    }
    // A fresh repo has no HEAD commit yet; fall back to the unborn branch name.
    if (error instanceof GitError && /unknown revision|ambiguous argument 'HEAD'/i.test(error.stderr)) {
      const unborn = ["symbolic-ref", "--short", "HEAD"];
      const { stdout } = await runGit(unborn, folder);
      return { kind: "repo", folder, branch: stdout.trim(), command: formatCommand(unborn) };
    }
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

function renderHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
  const nonce = createNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "pulse.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "pulse.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${style}" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
