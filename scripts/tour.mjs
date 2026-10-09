// The end-to-end tour: opens the real VS Code on a throwaway project, performs every GitKit action
// step by step, checks what git did, and screenshots the window after each step.
//   npm run tour            screenshots land in .vscode-test/tour/shots
// Windows only (screenshots use the Win32 API); it never touches your own VS Code or repos.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import * as esbuild from "esbuild";

if (process.platform !== "win32") {
  console.error("The tour takes screenshots with the Win32 API, so it runs on Windows only.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, ".vscode-test", "tour");
const out = join(root, "out", "tour");
const repo = join(base, "acme-web");
const remote = join(base, "acme-web.git");
const shots = join(base, "shots");
const userData = join(base, "user-data");

execFileSync(process.execPath, [join(root, "esbuild.mjs")], { cwd: root, stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [join(root, "test", "tour", "index.ts"), join(root, "test", "tour", "tour.test.ts")],
  outdir: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode", "mocha"],
  logLevel: "warning",
});

// --- The project ------------------------------------------------------------------------------

rmSync(base, { recursive: true, force: true });
for (const dir of [repo, shots, join(userData, "User")]) mkdirSync(dir, { recursive: true });

const people = {
  you: ["Jordan Lee", "jordan@acme.dev"],
  alex: ["Alex Chen", "alex@acme.dev"],
  priya: ["Priya Patel", "priya@acme.dev"],
};
const run = (cwd, who, ...args) =>
  execFileSync("git", ["-c", `user.name=${people[who][0]}`, "-c", `user.email=${people[who][1]}`, ...args], {
    cwd,
    stdio: "pipe",
  });
const write = (cwd, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
};
const commit = (cwd, who, message, files) => {
  write(cwd, files);
  run(cwd, who, "add", ".");
  run(cwd, who, "commit", "-qm", message);
};

execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { stdio: "pipe" });
run(repo, "you", "init", "-q", "-b", "main");
run(repo, "you", "config", "user.name", people.you[0]);
run(repo, "you", "config", "user.email", people.you[1]);
run(repo, "you", "remote", "add", "origin", remote);

commit(repo, "you", "chore: scaffold the app", {
  "package.json": JSON.stringify(
    { name: "acme-web", version: "1.2.0", scripts: { lint: "eslint .", test: "vitest", build: "vite build" } },
    null,
    2,
  ),
  "README.md": "# Acme Web\n\nThe storefront.\n",
  ".gitignore": "node_modules/\ndist/\n.env\n",
});
commit(repo, "alex", "feat: product list", { "src/products.js": "export const products = [];\n" });
commit(repo, "priya", "feat: cart totals", {
  "src/cart.js": "export function total(items) {\n  return items.reduce((sum, i) => sum + i.price, 0);\n}\n",
});
commit(repo, "you", "ci: lint and test on every push", {
  ".github/workflows/ci.yml": [
    "name: CI",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  lint:",
    "    name: Lint",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - uses: actions/setup-node@v7",
    "      - run: npm ci",
    "      - run: npm run lint",
    "  test:",
    "    name: Test",
    "    runs-on: ubuntu-latest",
    "    strategy:",
    "      matrix:",
    "        node: [22, 24]",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - uses: actions/setup-node@v7",
    "        with:",
    "          node-version: ${{ matrix.node }}",
    "      - run: npm ci",
    "      - run: npm test",
    "  build:",
    "    name: Build",
    "    needs: [lint, test]",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - run: npm ci && npm run build",
    "      - uses: actions/upload-pages-artifact@v5",
    "        with:",
    "          path: dist",
    "  deploy:",
    "    name: Deploy to Pages",
    "    needs: build",
    "    if: github.ref == 'refs/heads/main'",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      pages: write",
    "      id-token: write",
    "    environment: github-pages",
    "    steps:",
    "      - uses: actions/deploy-pages@v5",
    "",
  ].join("\n"),
});

// A feature branch merged back, so the map has a fork and a merge.
run(repo, "you", "switch", "-qc", "feat/search");
commit(repo, "alex", "feat: search box", { "src/search.js": "export const search = (q) => q.trim();\n" });
commit(repo, "alex", "test: search trims input", { "src/search.test.js": "// search trims input\n" });
run(repo, "you", "switch", "-q", "main");
commit(repo, "priya", "fix: rounding in totals", {
  "src/cart.js":
    "export function total(items) {\n  return Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;\n}\n",
});
run(repo, "you", "merge", "-q", "--no-ff", "feat/search", "-m", "Merge branch 'feat/search'");
run(repo, "you", "tag", "v1.2.0");
run(repo, "you", "push", "-q", "-u", "origin", "main", "--tags");
run(repo, "you", "branch", "-qD", "feat/search");

// Your published feature branch, plus a commit not pushed yet.
run(repo, "you", "switch", "-qc", "feat/checkout");
commit(repo, "you", "feat: checkout page", { "src/checkout.js": "export const checkout = () => 'ok';\n" });
run(repo, "you", "push", "-q", "-u", "origin", "feat/checkout");
commit(repo, "you", "feat: show the total at checkout", {
  "src/checkout.js":
    "import { total } from './cart.js';\nexport const checkout = (items) => `Total: ${total(items)}`;\n",
  "src/cart.js":
    "export function total(items) {\n  return items.reduce((sum, i) => sum + i.price * (i.qty ?? 1), 0);\n}\n",
});

// Teammates push to main meanwhile; one edits cart.js too, so updating from main will conflict.
const teammate = join(base, "teammate");
execFileSync("git", ["clone", "-q", remote, teammate], { stdio: "pipe" });
commit(teammate, "priya", "feat: discounts in totals", {
  "src/cart.js":
    "export function total(items, discount = 0) {\n  return items.reduce((sum, i) => sum + i.price, 0) * (1 - discount);\n}\n",
});
commit(teammate, "alex", "docs: how to run locally", {
  "README.md": "# Acme Web\n\nThe storefront.\n\n    npm run dev\n",
});
run(teammate, "alex", "push", "-q", "origin", "main");
rmSync(teammate, { recursive: true, force: true });

// Work in progress: something to stage, something new.
write(repo, {
  "src/products.js": "export const products = [\n  { id: 1, name: 'Mug', price: 12 },\n];\n",
  "notes.md": "- ask Priya about discounts\n",
});

// --- VS Code ----------------------------------------------------------------------------------

writeFileSync(
  join(userData, "User", "settings.json"),
  JSON.stringify(
    {
      "workbench.colorTheme": "Default Dark Modern",
      "workbench.startupEditor": "none",
      "workbench.tips.enabled": false,
      "workbench.secondarySideBar.defaultVisibility": "hidden",
      "chat.commandCenter.enabled": false,
      "chat.disableAIFeatures": true,
      "workbench.layoutControl.enabled": false,
      "window.commandCenter": false,
      "window.restoreWindows": "none",
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
      "extensions.ignoreRecommendations": true,
      "security.workspace.trust.enabled": false,
      "git.openRepositoryInParentFolders": "never",
      "editor.minimap.enabled": false,
      // GitKit fetches when asked, so screenshots don't change underneath the tour.
      "gitkit.autoFetchMinutes": 0,
      "gitkit.ciStatus": false,
    },
    null,
    2,
  ),
);

const vscodeExecutablePath = await downloadAndUnzipVSCode();
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(out, "index.js"),
    extensionTestsEnv: {
      TOUR_REPO: repo,
      TOUR_REMOTE: remote,
      TOUR_SHOTS: shots,
      TOUR_CODE_EXE: vscodeExecutablePath,
      TOUR_CAPTURE: join(root, "scripts", "capture-window.ps1"),
    },
    launchArgs: [
      repo,
      "--user-data-dir",
      userData,
      "--extensions-dir",
      join(base, "extensions"),
      "--skip-welcome",
      "--skip-release-notes",
    ],
  });
  console.log(`Tour finished. Screenshots: ${shots}`);
} catch (error) {
  console.error(`Tour failed: ${error instanceof Error ? error.message : error}`);
  console.error(`Screenshots so far: ${shots}`);
  process.exit(1);
}
