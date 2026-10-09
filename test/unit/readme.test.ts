import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Marketplace shows README.md from the package, where only the files .vscodeignore keeps are
// present. vsce rewrites relative image sources and Markdown links to the GitHub repository, but
// leaves HTML links as written, so those must already be absolute.

const root = join(__dirname, "../..");
const readme = readFileSync(join(root, "README.md"), "utf8");

describe("README", () => {
  it("only refers to files that exist in the repo", () => {
    const relative = [
      ...[...readme.matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1]),
      ...[...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]),
    ].filter((url) => !/^(https?:|#)/.test(url));
    expect(relative.length).toBeGreaterThan(0);
    for (const file of relative) expect(existsSync(join(root, file)), file).toBe(true);
  });

  it("uses absolute URLs in HTML links, which vsce doesn't rewrite", () => {
    const hrefs = [...readme.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.filter((url) => !/^https:\/\//.test(url))).toEqual([]);
  });
});
