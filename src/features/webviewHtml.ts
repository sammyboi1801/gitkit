import * as vscode from "vscode";

/** The HTML shell for a bundled webview entry (dist/webview/<entry>.js and .css), with a strict CSP. */
export function renderWebviewHtml(webview: vscode.Webview, distUri: vscode.Uri, entry: string): string {
  const nonce = createNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(distUri, `${entry}.js`));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(distUri, `${entry}.css`));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
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
