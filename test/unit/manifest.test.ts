import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

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
