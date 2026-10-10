import { describe, expect, it, vi } from "vitest";
import { renderWebviewHtml } from "../../src/features/webviewHtml";
import { Uri } from "../mocks/vscode";

const webview = { cspSource: "vscode-resource:", asWebviewUri: (uri: Uri) => uri };
const render = () => renderWebviewHtml(webview as never, Uri.file("/dist/webview") as never, "pulse");
const nonce = (html: string) => /script-src 'nonce-([^']+)'/.exec(html)?.[1];

describe("webview HTML", () => {
  it("allows only its own script, with a nonce from a secure random source", () => {
    // Math.random is predictable; the nonce must not depend on it.
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const [a, b] = [render(), render()];
      expect(nonce(a)).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
      expect(nonce(a)).not.toBe(nonce(b));
      expect(a).toContain(`<script nonce="${nonce(a)}"`);
      expect(a).toContain("default-src 'none'");
    } finally {
      random.mockRestore();
    }
  });
});
