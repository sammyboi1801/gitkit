import type { HistoryEntry, StashEntry } from "../shared/types";

// Turns HEAD's reflog into plain-English "what happened" entries, newest first, and lists stashes.

/** Format for `git reflog show --date=unix HEAD`, matching what parseHistory expects. */
export const REFLOG_FORMAT = "%H%x1f%gd%x1f%gs";
/** Format for `git stash list`, matching what parseStashes expects. */
export const STASH_FORMAT = "%gd%x1f%H%x1f%ct%x1f%gs";

interface RawEntry {
  hash: string;
  time: number;
  subject: string;
}

const REBASE_STEP =
  /^(?:pull --rebase|rebase)(?: -i| --interactive)? \((start|pick|continue|finish|squash|fixup|reword|edit|skip)\)(?:: (.*))?$/;

export function parseHistory(output: string): HistoryEntry[] {
  const raw: RawEntry[] = output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, selector, subject] = line.split("\x1f");
      return { hash, time: Number(/@\{(\d+)\}$/.exec(selector)?.[1] ?? 0), subject: subject ?? "" };
    });

  const entries: HistoryEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const step = REBASE_STEP.exec(entry.subject);

    // A rebase writes one reflog line per step; show it as one event, from finish back to start.
    if (step && step[1] === "finish") {
      let start = i;
      while (start + 1 < raw.length) {
        const older = REBASE_STEP.exec(raw[start + 1].subject);
        if (!older) break;
        start++;
        if (older[1] === "start") break;
      }
      const branch = /returning to refs\/heads\/(.+)$/.exec(entry.subject)?.[1] ?? "branch";
      const onto = /^checkout (.+)$/.exec(REBASE_STEP.exec(raw[start].subject)?.[2] ?? "")?.[1];
      entries.push({
        hash: entry.hash,
        before: raw[start + 1]?.hash ?? null,
        time: entry.time,
        kind: "rebase",
        summary: onto ? `Rebased ${branch} onto ${onto}` : `Rebased ${branch}`,
      });
      i = start;
      continue;
    }

    entries.push({ ...describe(entry.subject), hash: entry.hash, before: raw[i + 1]?.hash ?? null, time: entry.time });
  }
  return entries;
}

function describe(subject: string): Pick<HistoryEntry, "kind" | "summary" | "from" | "to"> {
  let m: RegExpExecArray | null;
  if ((m = /^commit \(amend\): (.*)$/.exec(subject))) return { kind: "amend", summary: `Amended "${m[1]}"` };
  if ((m = /^commit \(merge\): (.*)$/.exec(subject))) return { kind: "merge", summary: `Finished merge: ${m[1]}` };
  if ((m = /^commit(?: \(initial\))?: (.*)$/.exec(subject))) return { kind: "commit", summary: `Committed "${m[1]}"` };
  if ((m = /^checkout: moving from (.+) to (.+)$/.exec(subject))) {
    return { kind: "checkout", summary: `Switched ${m[1]} → ${m[2]}`, from: m[1], to: m[2] };
  }
  if ((m = /^merge (.+?): (.*)$/.exec(subject))) {
    const fastForward = /Fast-forward/i.test(m[2]);
    return { kind: "merge", summary: fastForward ? `Fast-forwarded to ${m[1]}` : `Merged ${m[1]}` };
  }
  if (/^pull\b/.test(subject)) return { kind: "pull", summary: "Pulled from the remote" };
  if ((m = /^reset: moving to (.+)$/.exec(subject)))
    return { kind: "reset", summary: `Moved branch to ${short(m[1])}` };
  if ((m = /^cherry-pick: (.*)$/.exec(subject))) return { kind: "cherry-pick", summary: `Cherry-picked "${m[1]}"` };
  if ((m = /^revert: (.*)$/.exec(subject))) return { kind: "revert", summary: m[1] };
  if (REBASE_STEP.test(subject)) return { kind: "rebase", summary: "Rebase step" };
  return { kind: "other", summary: subject };
}

const short = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

export function parseStashes(output: string): StashEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, time, subject] = line.split("\x1f");
      const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject ?? "");
      return {
        ref,
        hash,
        time: Number(time),
        branch: m?.[1] ?? null,
        message: m?.[2] ?? subject ?? "",
        byGitKit: /^GitKit /.test(m?.[2] ?? ""),
      };
    });
}

/**
 * Branches that existed once (seen in checkouts) but don't any more, with where they last pointed:
 * when HEAD left a branch, the entry just before that checkout is that branch's last commit.
 */
export function deletedBranches(entries: readonly HistoryEntry[], existing: ReadonlySet<string>) {
  const found = new Map<string, { name: string; hash: string; time: number }>();
  entries.forEach((entry) => {
    if (entry.kind !== "checkout" || !entry.from || !entry.before) return;
    if (existing.has(entry.from) || found.has(entry.from) || /^[0-9a-f]{7,40}$/.test(entry.from)) return;
    found.set(entry.from, { name: entry.from, hash: entry.before, time: entry.time });
  });
  return [...found.values()];
}

/**
 * How far back "undo" can safely go on the current branch: entries after the most recent
 * checkout belong to this branch. The checkout itself can be undone by switching back.
 */
export function undoableCount(entries: readonly HistoryEntry[]): number {
  const checkout = entries.findIndex((e) => e.kind === "checkout");
  return checkout === -1 ? entries.length : checkout + 1;
}
