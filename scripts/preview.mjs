// Renders the built webviews in a plain browser, with VS Code's Dark Modern colours and sample
// data, so the UI can be looked at (and screenshotted) without launching VS Code.
// Usage: npm run build && node scripts/preview.mjs   then open .vscode-test/preview/<name>.html
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

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

function page(entry, messages, extraCss = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>:root {\n  ${css}\n}\nbody { margin: 0; background: var(--vscode-editor-background); }
${extraCss}</style>
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
  // ...and an optional hover at the end: page.html#hover=main points at the "main" branch flag.
  const hover = new URLSearchParams(location.hash.slice(1)).get("hover");
  const next = () => {
    if (i >= steps.length) {
      const target = hover && document.querySelector(\`[data-branch="\${hover}"]\`);
      // After the first layout settles: it zooms and scrolls to the newest commits.
      setTimeout(() => target?.dispatchEvent(new PointerEvent("pointerenter")), 800);
      return;
    }
    const want = steps[i++].toLowerCase();
    const target = [...document.querySelectorAll("button, [role=button], summary")].find((el) =>
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

// The Branch Map shows this repo itself, read the same way the extension reads it. Remote state
// that may not exist locally (a branch behind main, CI) is filled in so the remote strip shows.
const reader = join(out, "read-repo.mjs");
await esbuild.build({
  entryPoints: [join(root, "src", "git", "repo.ts")],
  outfile: reader,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const { readRepo } = await import(pathToFileURL(reader).href);
const repo = await readRepo(root);
repo.status = { ...repo.status, upstream: repo.status.upstream ?? `origin/${repo.status.branch}`, ahead: 2, behind: 1 };
repo.base ??= { ref: "origin/main", name: "main", ahead: 2, behind: 3, isCurrent: false, conflicts: ["README.md"] };
repo.ci = {
  state: "success",
  sha: repo.status.oid,
  summary: "8 checks passed",
  failed: [],
  url: "https://github.com",
  runId: null,
};
repo.pr = {
  kind: "open",
  signedIn: true,
  pr: {
    number: 42,
    title: "feat: remote status on the Branch Map",
    url: "https://github.com",
    draft: false,
    base: "main",
    review: "required",
    unresolved: 2,
    mergeable: "clean",
  },
};
// Sample worktrees, as if two agents were working in their own checkouts.
if (!repo.worktrees.length) {
  const now = Math.floor(Date.now() / 1000);
  const tree = (path, branch, extra = {}) => ({
    path,
    branch,
    head: repo.status.oid,
    main: false,
    bare: false,
    locked: null,
    prunable: null,
    current: false,
    changes: 0,
    ahead: 0,
    behind: 0,
    lastActivity: null,
    ...extra,
  });
  const parent = dirname(root);
  repo.worktrees = [
    tree(root, repo.status.branch, { main: true, current: true }),
    tree(join(parent, "GitKit.worktrees", "agent-auth"), "agent/auth", {
      changes: 7,
      ahead: 3,
      lastActivity: now - 40,
      locked: "claude session",
    }),
    tree(join(parent, "GitKit.worktrees", "agent-docs"), "agent/docs", { ahead: 1, behind: 2, lastActivity: now - 3600 }),
    tree(join(parent, "GitKit.worktrees", "old-spike"), "spike/graph", { prunable: "gitdir file points to non-existent location" }),
  ];
  // Both agents touched the same files; their commits would conflict in one.
  repo.worktreeOverlaps = [
    {
      a: repo.worktrees[1].path,
      b: repo.worktrees[2].path,
      files: ["src/git/repo.ts", "README.md"],
      conflicts: ["src/git/repo.ts"],
    },
  ];
}
writeFileSync(join(out, "map.html"), page("map", [{ type: "state", state: { kind: "repo", repo } }]));
// Headless browsers lay pages out at least ~500px wide, so the sidebar width is set on the app itself.
writeFileSync(
  join(out, "pulse.html"),
  page("pulse", [{ type: "state", state: { kind: "repo", repo, repos: [] } }], "#app { width: 300px; }"),
);

console.log(`Previews written to ${out}`);
