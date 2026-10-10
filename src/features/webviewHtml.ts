import { randomBytes } from "node:crypto";
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

/** 128 bits from the OS's secure random source: a script can't guess it to sneak past the CSP. */
function createNonce(): string {
  return randomBytes(16).toString("base64");
}
