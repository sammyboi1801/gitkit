import type { Commit, Ref } from "../shared/types";

const FIELD = "\x1f";
const RECORD = "\x1e";

/** Format string for `git log --decorate=full`, matching what parseLog expects. */
export const LOG_FORMAT = ["%H", "%P", "%an", "%at", "%s", "%D"].join("%x1f") + "%x1e";

export function parseLog(output: string): Commit[] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, parents, author, time, subject, decorations] = record.split(FIELD);
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        author,
        time: Number(time),
        subject,
        refs: parseRefs(decorations ?? ""),
      };
    });
}

/** Parses a full-ref %D list, e.g. "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1". */
export function parseRefs(decorations: string): Ref[] {
  const refs: Ref[] = [];
  for (const raw of decorations.split(", ")) {
    let entry = raw.trim();
    if (!entry || entry === "HEAD") continue;

    let isHead = false;
    if (entry.startsWith("HEAD -> ")) {
      isHead = true;
      entry = entry.slice("HEAD -> ".length);
    }
    if (entry.startsWith("tag: ")) entry = entry.slice("tag: ".length);

    if (entry.startsWith("refs/heads/")) {
      refs.push({ name: entry.slice("refs/heads/".length), kind: "local", isHead });
    } else if (entry.startsWith("refs/remotes/")) {
      const name = entry.slice("refs/remotes/".length);
      // origin/HEAD only says which branch the remote defaults to; it's noise in a graph.
      if (!name.endsWith("/HEAD")) refs.push({ name, kind: "remote", isHead: false });
    } else if (entry.startsWith("refs/tags/")) {
      refs.push({ name: entry.slice("refs/tags/".length), kind: "tag", isHead: false });
    }
  }
  return refs;
}
