import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

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

export const samePath = (a: string, b: string): boolean => pathKey(realPath(a)) === pathKey(realPath(b));
