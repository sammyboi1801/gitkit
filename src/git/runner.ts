import { execFile } from "node:child_process";
import { formatCommand } from "./format";

export { formatCommand };

export interface GitResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra environment variables, e.g. to keep background fetches from prompting for credentials. */
  env?: Record<string, string>;
}

export class GitError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly stdout = "",
  ) {
    super(stderr.trim() || `${command} failed`);
    this.name = "GitError";
  }
}

/**
 * Makes git's output the same on every machine, so parsing never depends on the user's setup:
 * English messages (GitKit recognises some errors by text), no colour codes, and paths printed
 * as-is rather than octal-escaped. Config is injected via GIT_CONFIG_* so command lines (and
 * the previews built from them) stay exactly what the user would type.
 */
const STABLE_ENV: Record<string, string> = {
  LC_ALL: "C",
  // A terminal prompt would hang forever with no terminal attached; credential helpers still work.
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "color.ui",
  GIT_CONFIG_VALUE_0: "never",
  GIT_CONFIG_KEY_1: "core.quotePath",
  GIT_CONFIG_VALUE_1: "false",
};

// execFile, never a shell string: args are passed to git verbatim, so branch names can't inject commands.
export function runGit(args: readonly string[], cwd: string, options: RunOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...STABLE_ENV, ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          reject(new GitError(formatCommand(args), code, stderr || error.message, stdout));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
