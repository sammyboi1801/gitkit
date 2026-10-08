import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverRepos, pathKey, repoForPath, repoLabel } from "../../src/git/discover";

let base: string;
const repo = (...parts: string[]) => {
  const dir = join(base, ...parts);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "gitkit-discover-"));
  repo("api");
  repo("web");
  repo("libs", "shared");
  repo("libs", "deep", "too", "far");
  repo("node_modules", "some-package");
  repo(".hidden", "thing");
  // A worktree or submodule has a .git *file*.
  mkdirSync(join(base, "worktree"), { recursive: true });
  writeFileSync(join(base, "worktree", ".git"), "gitdir: elsewhere\n");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const sorted = (paths: string[]) => paths.map(pathKey).sort();

describe("discoverRepos", () => {
  it("finds nested repos within the depth, skipping dependencies and hidden folders", async () => {
    const found = await discoverRepos([base], 2, async () => null);
    expect(sorted(found)).toEqual(
      sorted([join(base, "api"), join(base, "web"), join(base, "libs", "shared"), join(base, "worktree")]),
    );
  });

  it("includes the repo the folder itself belongs to, once", async () => {
    const api = join(base, "api");
    const found = await discoverRepos([api], 1, async () => api);
    expect(sorted(found)).toEqual(sorted([api]));
  });
});

describe("repoForPath", () => {
  it("picks the deepest repo that contains the file", () => {
    const roots = [base, join(base, "libs", "shared")];
    expect(repoForPath(join(base, "libs", "shared", "src", "a.ts"), roots)).toBe(roots[1]);
    expect(repoForPath(join(base, "api", "main.py"), roots)).toBe(base);
    // A sibling whose name merely starts the same is not inside.
    expect(repoForPath(join(base + "-other", "x"), [base])).toBeUndefined();
  });
});

describe("repoLabel", () => {
  it("labels by path within the workspace folder, or by folder name", () => {
    expect(repoLabel(join(base, "libs", "shared"), [base])).toBe("libs/shared");
    expect(repoLabel(base, [base])).toMatch(/^gitkit-discover-/);
  });
});
