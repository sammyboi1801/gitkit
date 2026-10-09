import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Windows paths are case-insensitive; compare them that way. */
export function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Resolves junctions, symlinks and 8.3 short names, so two spellings of a folder compare equal. */
export function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

export const samePath = (a: string, b: string): boolean => pathKey(realPath(a)) === pathKey(realPath(b));
