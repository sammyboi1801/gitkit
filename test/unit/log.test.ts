import { describe, expect, it } from "vitest";
import { parseLog, parseRefs } from "../../src/git/log";

const record = (...fields: string[]) => fields.join("\x1f") + "\x1e";

describe("parseLog", () => {
  it("parses commits, including merges and roots", () => {
    const output =
      record("c3", "c2 c1", "Sam", "1700000300", "Merge feat", "HEAD -> refs/heads/main") +
      "\n" +
      record("c1", "", "Sam", "1700000100", "initial commit", "");
    expect(parseLog(output)).toEqual([
      {
        hash: "c3",
        parents: ["c2", "c1"],
        author: "Sam",
        time: 1700000300,
        subject: "Merge feat",
        refs: [{ name: "main", kind: "local", isHead: true }],
      },
      { hash: "c1", parents: [], author: "Sam", time: 1700000100, subject: "initial commit", refs: [] },
    ]);
  });
});

describe("parseRefs", () => {
  it("classifies local, remote and tag refs and drops origin/HEAD", () => {
    expect(
      parseRefs(
        "HEAD -> refs/heads/feat/login, refs/remotes/origin/feat/login, refs/remotes/origin/HEAD, tag: refs/tags/v1.0",
      ),
    ).toEqual([
      { name: "feat/login", kind: "local", isHead: true },
      { name: "origin/feat/login", kind: "remote", isHead: false },
      { name: "v1.0", kind: "tag", isHead: false },
    ]);
  });

  it("ignores a bare detached HEAD", () => {
    expect(parseRefs("HEAD")).toEqual([]);
  });
});
