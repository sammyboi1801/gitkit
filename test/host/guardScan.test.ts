import { describe, expect, it, vi } from "vitest";
import { git, makeRepo, write } from "../fixtures/repos";
import { harness } from "../mocks/vscode";
import { openPanel } from "./helpers";

// The commit guard's diff fails, as it does for a diff too big for git's output limit. Faked here
// rather than made real: a 35 MB file is slow to write and, on Windows CI, held open by antivirus.
vi.mock("../../src/git/runner", async (original) => {
  const real = await original<typeof import("../../src/git/runner")>();
  return {
    ...real,
    runGit: (
      args: readonly string[],
      ...rest: Parameters<typeof real.runGit> extends [unknown, ...infer R] ? R : never
    ) =>
      args[0] === "diff" && args.includes("-U0")
        ? Promise.reject(new real.GitError(real.formatCommand(args), null, "stdout maxBuffer length exceeded"))
        : real.runGit(args, ...rest),
  };
});

describe("Pulse panel: commit guard", () => {
  it("says so when it couldn't check the changes, instead of passing them", async () => {
    const dir = makeRepo();
    write(dir, "dump.sql", "INSERT INTO t VALUES (1);\n");
    git(dir, "add", "dump.sql");
    const panel = await openPanel(dir);
    harness.answers.push(undefined);
    await panel.send({ type: "action", request: { type: "commit", message: "dump" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("first");
    expect(harness.shown.at(-1)).toMatchObject({
      message: "GitKit couldn't check this commit for secrets.",
      detail: expect.stringMatching(/couldn't scan the changes for secrets \(stdout maxBuffer length exceeded\)/),
    });

    // Committing anyway is still the user's call.
    harness.answers.push("Commit Anyway");
    await panel.send({ type: "action", request: { type: "commit", message: "dump" } });
    expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("dump");
  });
});
