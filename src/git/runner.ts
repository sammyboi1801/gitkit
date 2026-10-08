import { execFile } from "node:child_process";
import { formatCommand } from "./format";

export { formatCommand };

export interface GitResult {
  stdout: string;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(stderr.trim() || `${command} failed`);
    this.name = "GitError";
  }
}

// execFile, never a shell string: args are passed to git verbatim, so branch names can't inject commands.
export function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        // A terminal prompt would hang forever with no terminal attached; credential helpers still work.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          reject(new GitError(formatCommand(args), code, stderr || error.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
