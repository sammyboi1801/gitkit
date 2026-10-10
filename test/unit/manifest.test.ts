import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { schemaProblems } from "../../src/workflow/schema";
import { tempDir, write } from "../fixtures/repos";

const root = join(__dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("what goes into the .vsix", () => {
  it("ships the built code, but never sourcemaps or sources, even from a development build", async () => {
    // vsce's own file list, over a copy of the repo's layout with a development build in dist/.
    const dir = tempDir();
    for (const file of ["package.json", ".vscodeignore", "README.md", "CHANGELOG.md", "LICENSE"]) {
      write(dir, file, readFileSync(join(root, file), "utf8"));
    }
    for (const file of [
      "dist/extension.js",
      "dist/extension.js.map",
      "dist/webview/pulse.js",
      "dist/webview/pulse.js.map",
      "dist/webview/pulse.css",
      "dist/webview/pulse.css.map",
      "dist/webview/codicon-AB12.ttf",
      "media/icon.png",
      "src/extension.ts",
    ]) {
      write(dir, file, "x");
    }
    const vsce = createRequire(__filename)("@vscode/vsce");
    const files: string[] = await vsce.listFiles({ cwd: dir, packageManager: vsce.PackageManager.None });
    expect(files.filter((f) => f.startsWith("dist/")).sort()).toEqual([
      "dist/extension.js",
      "dist/webview/codicon-AB12.ttf",
      "dist/webview/pulse.css",
      "dist/webview/pulse.js",
    ]);
    expect(files).not.toContain("src/extension.ts");
  });
});

describe("the repo's own CI", () => {
  const dir = join(root, ".github", "workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it.each(files)("%s pins every action to a commit, and keeps the token out of .git/config", (file) => {
    const text = readFileSync(join(dir, file), "utf8");
    // A tag can be moved to other code later; a commit SHA can't.
    const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
    const checkouts = text.match(/uses:\s*actions\/checkout@/g)?.length ?? 0;
    expect(text.match(/persist-credentials: false/g)?.length ?? 0).toBe(checkouts);
    expect(schemaProblems(parse(text))).toEqual([]);
  });
});

describe("package.json", () => {
  it("stays off in untrusted folders and virtual workspaces, and says why", () => {
    // git runs programs a repository can configure (hooks, core.fsmonitor), so an untrusted
    // folder must not get GitKit; and with no files on disk there's no git to run.
    expect(manifest.capabilities.untrustedWorkspaces).toEqual({
      supported: false,
      description: expect.stringMatching(/git.*trust/i),
    });
    expect(manifest.capabilities.virtualWorkspaces).toEqual({
      supported: false,
      description: expect.stringMatching(/git/i),
    });
  });
});
