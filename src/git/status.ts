import type { FileChange, StatusInfo } from "../shared/types";

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): StatusInfo {
  const info: StatusInfo = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const records = output.split("\0");

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    if (record.startsWith("# ")) {
      parseHeader(record.slice(2), info);
      continue;
    }

    switch (record[0]) {
      case "1": {
        // 1 XY sub mH mI mW hH hI path
        const fields = splitFields(record, 8);
        info.files.push(change(fields[1], fields[8]));
        break;
      }
      case "2": {
        // 2 XY sub mH mI mW hH hI Xscore path, then the original path as its own record.
        const fields = splitFields(record, 9);
        info.files.push({ ...change(fields[1], fields[9]), origPath: records[++i] });
        break;
      }
      case "u": {
        // u XY sub m1 m2 m3 mW h1 h2 h3 path
        const fields = splitFields(record, 10);
        info.files.push({
          path: fields[10],
          index: "U",
          worktree: "U",
          untracked: false,
          conflicted: true,
          conflict: fields[1],
        });
        break;
      }
      case "?":
        info.files.push({ path: record.slice(2), index: null, worktree: "?", untracked: true, conflicted: false });
        break;
    }
  }
  return info;
}

function parseHeader(header: string, info: StatusInfo): void {
  const space = header.indexOf(" ");
  const key = header.slice(0, space);
  const value = header.slice(space + 1);

  if (key === "branch.oid") info.oid = value === "(initial)" ? null : value;
  else if (key === "branch.head") info.branch = value === "(detached)" ? null : value;
  else if (key === "branch.upstream") info.upstream = value;
  else if (key === "branch.ab") {
    const match = /^\+(\d+) -(\d+)$/.exec(value);
    if (match) {
      info.ahead = Number(match[1]);
      info.behind = Number(match[2]);
    }
  }
}

// The path is the last field and may contain spaces, so only split the fixed fields before it.
function splitFields(record: string, fixed: number): string[] {
  const fields: string[] = [];
  let rest = record;
  for (let i = 0; i < fixed; i++) {
    const space = rest.indexOf(" ");
    fields.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  fields.push(rest);
  return fields;
}

function change(xy: string, path: string): FileChange {
  const letter = (c: string) => (c === "." ? null : c);
  return { path, index: letter(xy[0]), worktree: letter(xy[1]), untracked: false, conflicted: false };
}
