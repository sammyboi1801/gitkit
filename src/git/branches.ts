import type { Branch } from "../shared/types";

/** Format for `git for-each-ref refs/heads`, matching what parseBranches expects. */
export const BRANCH_FORMAT = [
  "%(HEAD)",
  "%(refname:short)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(committerdate:unix)",
  "%(subject)",
].join("%1f");

export function parseBranches(output: string): Branch[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [head, name, upstream, track, time, subject] = line.split("\x1f");
      return {
        name,
        upstream: upstream || null,
        ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
        behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
        gone: track === "[gone]",
        current: head === "*",
        time: Number(time),
        subject: subject ?? "",
      };
    });
}
