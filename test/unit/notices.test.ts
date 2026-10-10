import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledPackages } from "../../scripts/notices.mjs";

const root = join(__dirname, "../..");

describe("ThirdPartyNotices.txt", () => {
  it("names every package bundled into the extension, with its licence", async () => {
    const notices = readFileSync(join(root, "ThirdPartyNotices.txt"), "utf8");
    const bundled = await bundledPackages();
    expect(bundled.length).toBeGreaterThan(0);
    for (const [name, version, licence] of bundled) {
      expect(notices, `run npm run notices: ${name} is missing or out of date`).toContain(
        `${name} ${version} (${licence})`,
      );
    }
  }, 60_000);

  it("ships in the package", () => {
    expect(readFileSync(join(root, ".vscodeignore"), "utf8").split(/\r?\n/)).toContain("!ThirdPartyNotices.txt");
  });
});
