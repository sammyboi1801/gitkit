import type { ConflictBlock, Operation } from "../shared/types";

// Reads and resolves git's conflict markers in a file's text:
//   <<<<<<< ours-label
//   ...ours...
//   ||||||| base-label      (only with merge.conflictStyle=diff3/zdiff3)
//   ...base...
//   =======
//   ...theirs...
//   >>>>>>> theirs-label

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const SPLIT = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

interface Span extends ConflictBlock {
  /** Line indexes of the opening and closing markers. */
  from: number;
  to: number;
}

function scan(text: string): { lines: string[]; eol: string; spans: Span[] } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const spans: Span[] = [];

  let open: Partial<Span> & { section?: "ours" | "base" | "theirs" } = {};
  lines.forEach((line, i) => {
    let match: RegExpExecArray | null;
    if ((match = START.exec(line))) {
      open = { from: i, line: i + 1, oursLabel: match[1] ?? "", ours: [], base: null, theirs: [], section: "ours" };
    } else if (open.section === "ours" && BASE.test(line)) {
      open.base = [];
      open.section = "base";
    } else if ((open.section === "ours" || open.section === "base") && SPLIT.test(line)) {
      open.section = "theirs";
    } else if (open.section === "theirs" && (match = END.exec(line))) {
      spans.push({
        index: spans.length,
        line: open.line!,
        oursLabel: open.oursLabel!,
        theirsLabel: match[1] ?? "",
        ours: open.ours!,
        base: open.base ?? null,
        theirs: open.theirs!,
        from: open.from!,
        to: i,
      });
      open = {};
    } else if (open.section) {
      (open.section === "base" ? open.base! : open[open.section]!).push(line);
    }
  });
  return { lines, eol, spans };
}

export function parseConflicts(text: string): ConflictBlock[] {
  return scan(text).spans.map(({ index, line, oursLabel, theirsLabel, ours, base, theirs }) => ({
    index,
    line,
    oursLabel,
    theirsLabel,
    ours,
    base,
    theirs,
  }));
}

export type Resolution = "ours" | "theirs" | "both";

/**
 * Plain names for git's "ours" and "theirs", which mean different things per operation.
 * During a rebase, "ours" is the branch being rebased onto and "theirs" is your own commit.
 */
export function sideNames(operation: Operation | null): { ours: string; theirs: string } {
  switch (operation) {
    case "rebase":
      return { ours: "Upstream", theirs: "Your commit" };
    case "cherry-pick":
      return { ours: "Yours", theirs: "Picked commit" };
    case "revert":
      return { ours: "Yours", theirs: "The revert" };
    default:
      return { ours: "Yours", theirs: "Incoming" };
  }
}

/** Replaces one conflict (or all, with block = "all") by the chosen side(s), keeping line endings. */
export function resolveConflict(text: string, block: number | "all", choice: Resolution): string {
  const { lines, eol, spans } = scan(text);
  const targets = spans.filter((s) => block === "all" || s.index === block);
  if (targets.length === 0) return text;

  // Work from the bottom up so earlier line indexes stay valid.
  for (const span of [...targets].reverse()) {
    const kept = choice === "ours" ? span.ours : choice === "theirs" ? span.theirs : [...span.ours, ...span.theirs];
    lines.splice(span.from, span.to - span.from + 1, ...kept);
  }
  return lines.join(eol);
}
