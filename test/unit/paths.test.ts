import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { insideRoot } from "../../src/git/paths";

describe("insideRoot", () => {
  const root = resolve("/work/repo");

  it("joins a path inside the folder", () => {
    expect(insideRoot(root, "src/a.ts")).toBe(join(root, "src", "a.ts"));
    expect(insideRoot(root, "src/../b.ts")).toBe(join(root, "b.ts"));
    // A name that merely starts with two dots is a file like any other.
    expect(insideRoot(root, "..notes.md")).toBe(join(root, "..notes.md"));
  });

  it("refuses paths that leave the folder, or are the folder itself", () => {
    for (const path of ["../x", "../../etc/passwd", "src/../../x", resolve("/etc/passwd"), "", "."]) {
      expect(insideRoot(root, path), path).toBeNull();
    }
    // A sibling whose name starts with the folder's name is still outside it.
    expect(insideRoot(root, "../repo-other/x")).toBeNull();
  });
});
