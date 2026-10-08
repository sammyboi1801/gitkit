import { describe, expect, it } from "vitest";
import { parseConflicts, resolveConflict } from "../../src/git/conflicts";

const file = [
  "header",
  "<<<<<<< HEAD",
  "export const label = 'Go';",
  "=======",
  "export const label = 'Click me';",
  ">>>>>>> feat/label",
  "middle",
  "<<<<<<< HEAD",
  "a",
  "||||||| base",
  "original",
  "=======",
  "b",
  "c",
  ">>>>>>> feat/label",
  "footer",
].join("\n");

describe("parseConflicts", () => {
  it("finds each block with both sides, labels, line and optional base", () => {
    expect(parseConflicts(file)).toEqual([
      {
        index: 0,
        line: 2,
        oursLabel: "HEAD",
        theirsLabel: "feat/label",
        ours: ["export const label = 'Go';"],
        base: null,
        theirs: ["export const label = 'Click me';"],
      },
      {
        index: 1,
        line: 8,
        oursLabel: "HEAD",
        theirsLabel: "feat/label",
        ours: ["a"],
        base: ["original"],
        theirs: ["b", "c"],
      },
    ]);
  });

  it("returns nothing for a file without markers", () => {
    expect(parseConflicts("just\ntext\n")).toEqual([]);
  });
});

describe("resolveConflict", () => {
  it("keeps one side of one block and leaves the other block alone", () => {
    const result = resolveConflict(file, 0, "theirs");
    expect(result.split("\n").slice(0, 3)).toEqual(["header", "export const label = 'Click me';", "middle"]);
    expect(parseConflicts(result)).toHaveLength(1);
  });

  it("keeps both sides, yours first, dropping the base", () => {
    const result = resolveConflict(file, 1, "both");
    expect(result.split("\n").slice(-5)).toEqual(["middle", "a", "b", "c", "footer"]);
  });

  it("resolves every block at once and preserves CRLF line endings", () => {
    const crlf = file.replace(/\n/g, "\r\n");
    const result = resolveConflict(crlf, "all", "ours");
    expect(result).toBe(["header", "export const label = 'Go';", "middle", "a", "footer"].join("\r\n"));
  });
});
