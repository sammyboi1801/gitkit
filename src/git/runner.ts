import { execFile } from "node:child_process";

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

/** Renders args the way a user would type them, so every action can preview its exact command. */
export function formatCommand(args: readonly string[]): string {
  const quoted = args.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, "\\$1")}"`));
  return ["git", ...quoted].join(" ");
}

// execFile, never a shell string: args are passed to git verbatim, so branch names can't inject commands.
export function runGit(args: readonly string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const code = typeof error.code === "number" ? error.code : null;
        reject(new GitError(formatCommand(args), code, stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
