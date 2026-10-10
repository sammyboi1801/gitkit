import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Windows paths are case-insensitive; compare them that way. */
export function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Resolves junctions, symlinks and 8.3 short names (C:\Users\RUNNER~1), so two spellings of a folder
 * compare equal. For a path that doesn't exist (yet), the part that does is resolved.
 */
export function realPath(path: string): string {
  const full = resolve(path);
  try {
    return realpathSync.native(full);
  } catch {
    const parent = dirname(full);
    return parent === full ? full : join(realPath(parent), basename(full));
  }
}

/**
 * `path` resolved against `root`, or null when it lands outside it (or on `root` itself). Paths
 * from a webview or from GitHub go through this before they're opened, read or written.
 */
export function insideRoot(root: string, path: string): string | null {
  const full = resolve(root, path);
  const back = relative(resolve(root), full);
  const climbs = back === ".." || back.startsWith(`..${sep}`);
  return back && !climbs && !isAbsolute(back) ? full : null;
}

export const samePath = (a: string, b: string): boolean => pathKey(realPath(a)) === pathKey(realPath(b));
