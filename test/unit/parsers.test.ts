import { describe, expect, it } from "vitest";
import { parseBranches } from "../../src/git/branches";
import { parseNumstat } from "../../src/git/numstat";

describe("parseNumstat", () => {
  it("parses text and binary files, including paths with tabs-free spaces", () => {
    expect(parseNumstat("12\t3\tsrc/app file.ts\0-\t-\tlogo.png\0")).toEqual([
      { path: "src/app file.ts", stats: { added: 12, removed: 3, binary: false } },
      { path: "logo.png", stats: { added: 0, removed: 0, binary: true } },
    ]);
  });

  it("handles the leading newline git show emits after an empty format", () => {
    expect(parseNumstat("\n1\t0\ta.py\0")).toEqual([{ path: "a.py", stats: { added: 1, removed: 0, binary: false } }]);
  });
});

describe("parseBranches", () => {
  const line = (...fields: string[]) => fields.join("\x1f");

  it("reads current branch, tracking counts and deleted upstreams", () => {
    const output = [
      line("*", "feat/login", "origin/feat/login", "[ahead 1, behind 2]", "1700000000", "add login"),
      line(" ", "old", "origin/old", "[gone]", "1600000000", "old work"),
      line(" ", "scratch", "", "", "1650000000", "wip"),
    ].join("\n");
    expect(parseBranches(output)).toEqual([
      {
        name: "feat/login",
        upstream: "origin/feat/login",
        ahead: 1,
        behind: 2,
        gone: false,
        current: true,
        time: 1700000000,
        subject: "add login",
      },
      {
        name: "old",
        upstream: "origin/old",
        ahead: 0,
        behind: 0,
        gone: true,
        current: false,
        time: 1600000000,
        subject: "old work",
      },
      {
        name: "scratch",
        upstream: null,
        ahead: 0,
        behind: 0,
        gone: false,
        current: false,
        time: 1650000000,
        subject: "wip",
      },
    ]);
  });
});
