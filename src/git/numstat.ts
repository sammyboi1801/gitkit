import type { CommitFile, LineStats } from "../shared/types";

/** Parses `git diff --numstat -z --no-renames`: "added\tremoved\tpath\0" per file, "-" for binary. */
export function parseNumstat(output: string): CommitFile[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [added, removed, ...rest] = record.replace(/^\n/, "").split("\t");
      const binary = added === "-" && removed === "-";
      const stats: LineStats = { added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary };
      return { path: rest.join("\t"), stats };
    });
}

export function toStatsMap(files: readonly CommitFile[]): Map<string, LineStats> {
  return new Map(files.map((f) => [f.path, f.stats]));
}
