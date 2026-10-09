import { runGit } from "./runner";

// New commits that a background fetch brought in, and how to tell someone about them in a sentence.

/** Commits other people added to a remote branch since the last fetch. */
export interface Arrival {
  /** e.g. "origin/main". */
  ref: string;
  /** The current branch's own remote branch: someone else pushed to it. */
  yours: boolean;
  commits: number;
  /** In the order git listed their commits, newest first, each once. */
  authors: string[];
}

/** Reads `git log --format=%an%x09%ae old..new`, leaving out your own commits. */
export function parseArrivalLog(out: string, me: string | null): { commits: number; authors: string[] } {
  const mine = me?.trim().toLowerCase();
  const authors: string[] = [];
  let commits = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [name, email = ""] = line.split("\t");
    // Pushed from another machine of yours, or by you on GitHub: not news to you.
    if (mine && email.trim().toLowerCase() === mine) continue;
    commits++;
    if (!authors.includes(name)) authors.push(name);
  }
  return { commits, authors };
}

/** "Alex Chen", "Alex Chen and Priya Patel", "Alex Chen, Priya Patel and 2 others". */
export function whoText(authors: readonly string[]): string {
  if (authors.length === 0) return "Someone";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  const others = authors.length - 2;
  return `${authors[0]}, ${authors[1]} and ${others} other${others === 1 ? "" : "s"}`;
}

const commitsText = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/**
 * One sentence for a pop-up, your branch first since that's the one to pull before pushing:
 * "Alex Chen pushed 2 commits to origin/feat/login." Null when nothing arrived.
 */
export function arrivalMessage(arrivals: readonly Arrival[]): string | null {
  const news = arrivals.filter((a) => a.commits > 0).sort((a, b) => Number(b.yours) - Number(a.yours));
  if (!news.length) return null;
  const [first, ...rest] = news;
  const lead = `${whoText(first.authors)} pushed ${commitsText(first.commits)} to ${first.ref}`;
  if (!rest.length) return `${lead}.`;
  const more = rest.map((a) => `${commitsText(a.commits)} on ${a.ref}`).join(" and ");
  return `${lead}, and there ${rest[0].commits === 1 && rest.length === 1 ? "is" : "are"} ${more}.`;
}

export const arrivedCount = (arrivals: readonly Arrival[]) => arrivals.reduce((n, a) => n + a.commits, 0);

const read = (args: string[], root: string) => runGit(["--no-optional-locks", ...args], root);

/** What each remote branch ("origin/main") points at now; ones that don't exist are left out. */
export async function remoteTips(root: string, refs: readonly string[]): Promise<Map<string, string>> {
  const tips = new Map<string, string>();
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      const out = await read(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}^{commit}`], root).catch(
        () => null,
      );
      const sha = out?.stdout.trim();
      if (sha) tips.set(ref, sha);
    }),
  );
  return tips;
}

/** Other people's commits that arrived on these remote branches since `before` was read. */
export async function readArrivals(
  root: string,
  before: ReadonlyMap<string, string>,
  yours: string | null,
): Promise<Arrival[]> {
  const [after, me] = await Promise.all([
    remoteTips(root, [...before.keys()]),
    read(["config", "user.email"], root).then(
      (r) => r.stdout.trim() || null,
      () => null,
    ),
  ]);
  const arrivals: Arrival[] = [];
  for (const [ref, old] of before) {
    const now = after.get(ref);
    if (!now || now === old) continue;
    // After a force-push old..now still lists just the commits that are new.
    const log = await read(["log", "--format=%an%x09%ae", `${old}..${now}`], root).catch(() => null);
    if (!log) continue;
    const { commits, authors } = parseArrivalLog(log.stdout, me);
    if (commits) arrivals.push({ ref, yours: ref === yours, commits, authors });
  }
  return arrivals;
}
