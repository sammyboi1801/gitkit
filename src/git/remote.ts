import type { ActivityItem } from "../shared/types";

// Pure helpers for remote state: base-branch choice, merge-tree output, reflog entries.

const BASE_NAMES = ["main", "master", "develop", "trunk"];

/**
 * Picks the branch work usually merges into: the remote's default (origin/HEAD) if known,
 * otherwise a conventional name on the remote, otherwise a local one.
 */
export function pickBaseRef(
  remoteDefault: string | null,
  remote: string | null,
  refs: readonly string[],
): { ref: string; name: string } | null {
  const has = new Set(refs);
  if (remoteDefault && has.has(remoteDefault)) {
    return { ref: remoteDefault, name: remoteDefault.slice(remoteDefault.indexOf("/") + 1) };
  }
  for (const name of BASE_NAMES) {
    if (remote && has.has(`${remote}/${name}`)) return { ref: `${remote}/${name}`, name };
  }
  for (const name of BASE_NAMES) {
    if (has.has(name)) return { ref: name, name };
  }
  return null;
}

/** Parses `git merge-tree --write-tree --name-only --no-messages`: tree oid, then conflicted paths. */
export function parseMergeTree(output: string): string[] {
  const [, ...rest] = output.split("\n");
  const end = rest.indexOf("");
  return end === -1 ? rest : rest.slice(0, end);
}

export interface ReflogEntry {
  hash: string;
  time: number;
  subject: string;
}

/** Parses `git reflog show --date=unix --format=%H%x1f%gd%x1f%gs`, newest first. */
export function parseReflog(output: string): ReflogEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, selector, subject] = line.split("\x1f");
      const time = Number(/@\{(\d+)\}$/.exec(selector)?.[1] ?? 0);
      return { hash, time, subject: subject ?? "" };
    });
}

export function activityKind(subject: string): ActivityItem["kind"] {
  if (/forced-update/.test(subject)) return "forced";
  if (/^update by push/.test(subject)) return "push";
  if (/storing head|created/.test(subject)) return "created";
  return "fetch";
}
