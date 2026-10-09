// Renders the built webviews in a plain browser, with VS Code's Dark Modern colours and sample
// data, so the UI can be looked at (and screenshotted) without launching VS Code.
// Usage: npm run build && node scripts/preview.mjs   then open .vscode-test/preview/<name>.html
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vscode-test", "preview");
mkdirSync(out, { recursive: true });

// A subset of VS Code's Dark Modern theme: every variable the webviews read.
const THEME = {
  "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "font-size": "13px",
  "editor-font-family": "Consolas, 'Courier New', monospace",
  "editor-font-size": "13px",
  foreground: "#cccccc",
  descriptionForeground: "#9d9d9d",
  "editor-background": "#1f1f1f",
  "sideBar-background": "#181818",
  "widget-border": "#313131",
  "panel-border": "#2b2b2b",
  focusBorder: "#0078d4",
  "button-background": "#0078d4",
  "button-foreground": "#ffffff",
  "button-hoverBackground": "#026ec1",
  "button-secondaryBackground": "#313131",
  "button-secondaryForeground": "#cccccc",
  "button-secondaryHoverBackground": "#3c3c3c",
  "button-border": "#ffffff12",
  "input-background": "#313131",
  "input-foreground": "#cccccc",
  "input-border": "#3c3c3c",
  "input-placeholderForeground": "#989898",
  "dropdown-background": "#313131",
  "dropdown-foreground": "#cccccc",
  "dropdown-border": "#3c3c3c",
  "list-hoverBackground": "#2a2d2e",
  "list-inactiveSelectionBackground": "#37373d",
  "badge-background": "#616161",
  "badge-foreground": "#f8f8f8",
  "toolbar-hoverBackground": "#5a5d5e50",
  "toolbar-activeBackground": "#63666750",
  "textLink-foreground": "#4daafc",
  "editorWidget-background": "#202020",
  "editorWarning-foreground": "#cca700",
  errorForeground: "#f85149",
  "charts-blue": "#3794ff",
  "charts-purple": "#b180d7",
  "charts-green": "#89d185",
  "charts-orange": "#d18616",
  "charts-red": "#f14c4c",
  "charts-yellow": "#cca700",
  "textCodeBlock-background": "#2b2b2b",
  "icon-foreground": "#cccccc",
  "menu-background": "#1f1f1f",
  "menu-foreground": "#cccccc",
  "menu-border": "#454545",
  "menu-selectionBackground": "#0078d4",
  "editorHoverWidget-background": "#202020",
  "editorHoverWidget-foreground": "#cccccc",
  "editorHoverWidget-border": "#454545",
  "gitDecoration-addedResourceForeground": "#81b88b",
  "gitDecoration-modifiedResourceForeground": "#e2c08d",
  "gitDecoration-deletedResourceForeground": "#c74e39",
  "gitDecoration-untrackedResourceForeground": "#73c991",
  "gitDecoration-conflictingResourceForeground": "#e4676b",
  "testing-iconPassed": "#73c991",
  "testing-iconFailed": "#f14c4c",
};

const css = Object.entries(THEME)
  .map(([k, v]) => `--vscode-${k}: ${v};`)
  .join("\n  ");

function page(entry, messages) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>:root {\n  ${css}\n}\nbody { margin: 0; background: var(--vscode-editor-background); }</style>
<link rel="stylesheet" href="../../dist/webview/${entry}.css" />
</head>
<body>
<div id="app"></div>
<script>
  const replies = ${JSON.stringify(messages)};
  window.sent = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.sent.push(message);
      if (message.type === "ready") for (const m of replies) setTimeout(() => window.postMessage(m, "*"), 0);
    },
    getState: () => undefined,
    setState: () => {},
  });
</script>
<script src="../../dist/webview/${entry}.js"></script>
<script>
  // Optional scripted clicks, for screenshots of deeper screens:
  //   page.html#click=Check every push|Add a job after Lint
  // Each step clicks the first button whose text or label contains that phrase.
  const steps = new URLSearchParams(location.hash.slice(1)).get("click")?.split("|") ?? [];
  let i = 0;
  const next = () => {
    if (i >= steps.length) return;
    const want = steps[i++].toLowerCase();
    const target = [...document.querySelectorAll("button, [role=button]")].find((el) =>
      ((el.getAttribute("aria-label") ?? "") + " " + el.textContent).toLowerCase().includes(want),
    );
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    setTimeout(next, 150);
  };
  setTimeout(next, 300);
</script>
</body>
</html>`;
}

const facts = {
  files: ["package.json", "Dockerfile"],
  npmScripts: { lint: "eslint .", test: "vitest", build: "tsc" },
  defaultBranch: "main",
};

writeFileSync(
  join(out, "workflow.html"),
  page("workflow", [
    {
      type: "init",
      repoName: "gitkit",
      facts,
      suggestion: null,
      files: [
        { file: "ci.yml", byGitKit: true, summary: "CI · on push to main, on pull requests · 5 jobs" },
        { file: "release.yml", byGitKit: false, summary: "Release · on push of tags v* · 1 job" },
      ],
    },
  ]),
);

console.log(`Previews written to ${out}`);
