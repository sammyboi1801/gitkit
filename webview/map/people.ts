import type { Commit } from "../../src/shared/types";

/** "Sam Selvaraj" → "SS", "alex" → "AL", "Jean-Luc Picard" → "JP". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface Person {
  name: string;
  initials: string;
  commits: number;
}

/** Everyone who committed in the loaded history, most active first. */
export function people(commits: readonly Commit[]): Person[] {
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts]
    .map(([name, commits]) => ({ name, initials: initials(name), commits }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

/** Search across subject, author and hash; empty query matches nothing (no highlighting). */
export function matches(commit: Commit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    commit.subject.toLowerCase().includes(q) || commit.author.toLowerCase().includes(q) || commit.hash.startsWith(q)
  );
}
