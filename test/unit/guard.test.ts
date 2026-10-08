import { describe, expect, it } from "vitest";
import { addedLines, checkFiles, matchIdentity, normalizeRemote, scanForSecrets } from "../../src/git/guard";

describe("addedLines", () => {
  it("collects only added lines, with their new line numbers, per file", () => {
    const diff = [
      "diff --git a/config.ts b/config.ts",
      "--- a/config.ts",
      "+++ b/config.ts",
      "@@ -10,0 +11,2 @@",
      "+const region = 'us-east-1';",
      "+const key = 'AKIAABCDEFGHIJKLMNOP';",
      "@@ -20 +22 @@",
      "-old",
      "+new",
      "diff --git a/gone.txt b/gone.txt",
      "--- a/gone.txt",
      "+++ /dev/null",
    ].join("\n");
    expect(addedLines(diff).get("config.ts")).toEqual([
      { line: 11, text: "const region = 'us-east-1';" },
      { line: 12, text: "const key = 'AKIAABCDEFGHIJKLMNOP';" },
      { line: 22, text: "new" },
    ]);
    expect(addedLines(diff).has("/dev/null")).toBe(false);
  });
});

describe("scanForSecrets", () => {
  it("flags well-known key formats, once per file, with the line", () => {
    const added = new Map([
      ["config.ts", [{ line: 12, text: "const key = 'AKIAABCDEFGHIJKLMNOP';" }]],
      ["id", [{ line: 1, text: "-----BEGIN OPENSSH PRIVATE KEY-----" }]],
      ["ok.ts", [{ line: 1, text: "const greeting = 'hello';" }]],
    ]);
    expect(scanForSecrets(added)).toEqual([
      { path: "config.ts", line: 12, kind: "secret", detail: "looks like an AWS access key" },
      { path: "id", line: 1, kind: "secret", detail: "looks like a private key" },
    ]);
  });
});

describe("checkFiles", () => {
  it("flags secrets files and big files, but not templates", () => {
    const issues = checkFiles(
      [
        { path: ".env", size: 100 },
        { path: "app/.env.production", size: 100 },
        { path: ".env.example", size: 100 },
        { path: "certs/server.pem", size: 100 },
        { path: "models/weights.ckpt", size: 200 * 1024 * 1024 },
        { path: "src/app.ts", size: 2000 },
      ],
      10 * 1024 * 1024,
    );
    expect(issues.map((i) => [i.path, i.kind])).toEqual([
      [".env", "sensitive-file"],
      ["app/.env.production", "sensitive-file"],
      ["certs/server.pem", "sensitive-file"],
      ["models/weights.ckpt", "large-file"],
    ]);
  });
});

describe("identity rules", () => {
  it("normalizes ssh and https remotes the same way", () => {
    expect(normalizeRemote("git@github.com:neu-ds/project.git")).toBe("github.com/neu-ds/project");
    expect(normalizeRemote("https://github.com/neu-ds/project")).toBe("github.com/neu-ds/project");
    expect(normalizeRemote("https://user@github.com/neu-ds/project.git/")).toBe("github.com/neu-ds/project");
    expect(normalizeRemote("ssh://git@host.com:2222/org/repo.git")).toBe("host.com:2222/org/repo");
  });

  it("matches by remote glob or by folder, first rule wins", () => {
    const rules = [
      { remote: "github.com/neu-*/**", email: "me@northeastern.edu" },
      { folder: "D:/Northeastern University", email: "me@northeastern.edu" },
      { remote: "github.com/**", email: "me@gmail.com" },
    ];
    expect(matchIdentity(rules, "git@github.com:neu-ds/hw1.git", "C:/x")?.email).toBe("me@northeastern.edu");
    expect(matchIdentity(rules, null, "D:\\Northeastern University\\Course\\hw")?.email).toBe("me@northeastern.edu");
    expect(matchIdentity(rules, "https://github.com/sam/gitkit", "D:/Python Projects/GitKit")?.email).toBe(
      "me@gmail.com",
    );
    expect(matchIdentity(rules, null, "D:/Other")).toBeUndefined();
  });
});
