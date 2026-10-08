import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

// Folders that are never worth scanning for repos: dependencies, environments, build output.
const SKIP = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "venv",
  "env",
  "__pycache__",
  "site-packages",
  "dist",
  "build",
  "out",
  "target",
]);

const MAX_REPOS = 50;

/**
 * Finds git repos for the open workspace folders: the repo each folder is in (even if the folder
 * is a subfolder of it), plus nested repos up to `depth` levels down.
 * `findRoot` resolves a folder to its repo root, or null; injected so this stays testable.
 */
export async function discoverRepos(
  folders: readonly string[],
  depth: number,
  findRoot: (folder: string) => Promise<string | null>,
): Promise<string[]> {
  const found = new Map<string, string>();
  const add = (path: string) => {
    const key = pathKey(path);
    if (!found.has(key) && found.size < MAX_REPOS) found.set(key, resolve(path));
  };

  for (const folder of folders) {
    const root = await findRoot(folder).catch(() => null);
    if (root) add(root);
    await scan(folder, depth, add);
  }
  return [...found.values()];
}

async function scan(dir: string, depth: number, add: (path: string) => void): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Unreadable folders are simply skipped.
  }
  // .git is a folder in a normal repo and a file in worktrees and submodules.
  if (entries.some((e) => e.name === ".git")) add(dir);
  if (depth <= 0) return;

  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => scan(join(dir, e.name), depth - 1, add)),
  );
}

/** Windows paths are case-insensitive; compare them that way. */
export function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** The repo that contains a file: the deepest root its path is inside. */
export function repoForPath(file: string, roots: readonly string[]): string | undefined {
  const key = pathKey(file);
  let best: string | undefined;
  for (const root of roots) {
    const r = pathKey(root);
    const inside = key === r || key.startsWith(r.endsWith(sep) ? r : r + sep);
    if (inside && (!best || root.length > best.length)) best = root;
  }
  return best;
}

/** A short label: the path relative to its workspace folder, or the folder's own name. */
export function repoLabel(root: string, folders: readonly string[]): string {
  for (const folder of folders) {
    const rel = relative(folder, root);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return basename(root);
}
