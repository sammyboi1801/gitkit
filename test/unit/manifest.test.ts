import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { schemaProblems } from "../../src/workflow/schema";

const root = join(__dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

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
