import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

// Throwaway git repos for tests. Every test gets its own, so tests never depend on each other's
// side effects or run order, and nothing touches a real repo or the machine's git config.

const created: string[] = [];

// Registered once per test file that imports this module.
afterEach(() => {
  // Windows can hold a file briefly after a process exits; retry instead of failing the test.
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 });
});

/**
 * Runs git with a fixed identity and a neutral environment: English messages, no global or
 * system config (which on CI or a dev machine could set hooks, signing or a default branch).
 */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

export function tempDir(prefix = "gitkit-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function write(cwd: string, file: string, content: string): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), content);
}

/** Writes the files and commits them. */
export function commit(cwd: string, message: string, files: Record<string, string> = {}): string {
  for (const [file, content] of Object.entries(files)) write(cwd, file, content);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD").trim();
}

/**
 * git init on main, with a repo-local identity: tests run with no global config, and GitKit's
 * own commits, rebases and merges need one.
 */
export function initRepo(dir: string): string {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  return dir;
}

/** A fresh repo on main with one commit. */
export function makeRepo(): string {
  const dir = initRepo(tempDir());
  commit(dir, "first", { "a.txt": "one\n" });
  return dir;
}

/**
 * A clone of a bare remote where main is one commit ahead ("local only") and one behind
 * ("remote only"), with a staged edit, an unstaged edit and an untracked file.
 */
export function makeDivergedClone(): { work: string; remote: string } {
  const base = tempDir();
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "clone", "-q", remote, work);
  git(work, "checkout", "-q", "-b", "main");
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");

  commit(work, "first", { "a.txt": "one\n" });
  commit(work, "second", { "a.txt": "one\ntwo\n" });
  git(work, "push", "-q", "-u", "origin", "main");

  commit(work, "remote only", { "b.txt": "remote\n" });
  git(work, "push", "-q");
  git(work, "reset", "-q", "--hard", "HEAD~1");
  commit(work, "local only", { "c.txt": "local\n" });

  write(work, "a.txt", "one\ntwo\nthree\n");
  git(work, "add", "a.txt");
  write(work, "c.txt", "local\nmore\nlines\n");
  write(work, "new file.txt", "hi\n");
  return { work, remote };
}
