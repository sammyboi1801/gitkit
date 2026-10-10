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

describe("scanForSecrets, more providers", () => {
  // Built from pieces so this file never holds anything shaped like a real token.
  const fake = (prefix: string, length: number, alphabet = "aB3") =>
    prefix + alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);

  it.each([
    ["an npm token", `//registry.npmjs.org/:_authToken=${fake("npm_", 36)}`],
    ["a private key", "-----BEGIN PGP PRIVATE KEY BLOCK-----"],
    ["an AWS access key", `aws_access_key_id = ${fake("ASIA", 16, "QZ7")}`],
    ["a Stripe live key", fake("rk_live_", 24)],
    ["a SendGrid API key", `${fake("SG.", 22)}.${fake("", 43)}`],
  ])("finds %s", (what, text) => {
    expect(scanForSecrets(new Map([["f", [{ line: 1, text }]]]))).toEqual([
      { path: "f", line: 1, kind: "secret", detail: `looks like ${what}` },
    ]);
  });
});

describe("checkFiles", () => {
  it("flags credential files git hosts and cloud tools write", () => {
    const issues = checkFiles(
      [".aws/credentials", ".git-credentials", "infra/prod.tfvars", "infra/prod.auto.tfvars", "src/credentials.ts"].map(
        (path) => ({ path, size: 10 }),
      ),
      10 * 1024 * 1024,
    );
    expect(issues.map((i) => i.path)).toEqual([
      ".aws/credentials",
      ".git-credentials",
      "infra/prod.tfvars",
      "infra/prod.auto.tfvars",
    ]);
  });

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
