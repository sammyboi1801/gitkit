// Runs the integration tests inside a real VS Code: builds the extension and the tests, makes a
// throwaway git repo to open, downloads VS Code if needed (cached in .vscode-test), and runs.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out", "integration");
const workspace = join(root, ".vscode-test", "integration-repo");

execFileSync(process.execPath, [join(root, "esbuild.mjs")], { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
await esbuild.build({
  entryPoints: [join(root, "test", "integration", "index.ts"), join(root, "test", "integration", "smoke.test.ts")],
  outdir: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode", "mocha"],
  logLevel: "warning",
});

// A small repo with a branch and a merge, so every view has something to show.
rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: workspace, stdio: "pipe" });
git("init", "-q", "-b", "main");
writeFileSync(join(workspace, "app.txt"), "one\n");
git("add", ".");
git("commit", "-qm", "first");
git("switch", "-qc", "feature");
writeFileSync(join(workspace, "feature.txt"), "f\n");
git("add", ".");
git("commit", "-qm", "feature work");
git("switch", "-q", "main");
git("merge", "-q", "--no-ff", "feature", "-m", "Merge branch 'feature'");
writeFileSync(join(workspace, "app.txt"), "one\ntwo\n");

// VS Code's own terminals set this; inherited, it makes the test copy of VS Code start as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(out, "index.js"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
  });
} catch (error) {
  console.error("Integration tests failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
