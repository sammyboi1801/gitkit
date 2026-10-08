import { describe, expect, it } from "vitest";
import { activityKind, parseMergeTree, parseReflog, pickBaseRef } from "../../src/git/remote";

describe("pickBaseRef", () => {
  it("prefers the remote's default branch", () => {
    expect(pickBaseRef("origin/develop", "origin", ["origin/develop", "origin/main"])).toEqual({
      ref: "origin/develop",
      name: "develop",
    });
  });

  it("falls back to conventional names, remote first, then local", () => {
    expect(pickBaseRef(null, "origin", ["origin/master", "main"])).toEqual({ ref: "origin/master", name: "master" });
    expect(pickBaseRef(null, null, ["feat/x", "main"])).toEqual({ ref: "main", name: "main" });
    expect(pickBaseRef(null, "origin", ["feat/x"])).toBeNull();
  });
});

describe("parseMergeTree", () => {
  it("returns the conflicted paths after the tree id", () => {
    expect(parseMergeTree("abc123\napp.py\nsrc/b.ts\n")).toEqual(["app.py", "src/b.ts"]);
    expect(parseMergeTree("abc123\n")).toEqual([]);
  });
});

describe("parseReflog", () => {
  it("reads hash, unix time and subject", () => {
    const out =
      "h2\x1forigin/main@{1791499768}\x1fupdate by push\nh1\x1forigin/main@{1791499767}\x1ffetch: fast-forward\n";
    expect(parseReflog(out)).toEqual([
      { hash: "h2", time: 1791499768, subject: "update by push" },
      { hash: "h1", time: 1791499767, subject: "fetch: fast-forward" },
    ]);
  });

  it("classifies entries", () => {
    expect(activityKind("update by push")).toBe("push");
    expect(activityKind("fetch: fast-forward")).toBe("fetch");
    expect(activityKind("fetch: forced-update")).toBe("forced");
    expect(activityKind("fetch: storing head")).toBe("created");
  });
});
