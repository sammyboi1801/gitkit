import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_REFS,
  agentCommand,
  checkpointsToDrop,
  createCheckpoint,
  listCheckpoints,
  parseCheckpoints,
  readCheckpointState,
  worktreeId,
  type CheckpointOptions,
} from "../../src/git/checkpoints";
import type { Checkpoint } from "../../src/shared/types";
import { commit, git, initRepo, makeRepo, tempDir, write } from "../fixtures/repos";

const options = (overrides: Partial<CheckpointOptions> = {}): CheckpointOptions => ({
  reason: "before claude",
  maxFileBytes: 1024 * 1024,
  keep: 20,
  maxAgeDays: 30,
  ...overrides,
});
const MB = 1024 * 1024;

/** Everything a checkpoint must not change: files, staging area, stash list, branch. */
function untouched(dir: string) {
  return {
    status: git(dir, "status", "--porcelain", "--untracked-files=all"),
    staged: git(dir, "diff", "--cached"),
    stashes: git(dir, "stash", "list"),
    head: git(dir, "rev-parse", "HEAD"),
  };
}

describe("createCheckpoint", () => {
  it("snapshots new, changed and deleted files without touching the files, staging area or stashes", async () => {
    const dir = makeRepo();
    commit(dir, "more", { "gone.txt": "bye\n", "staged.txt": "v1\n" });
    write(dir, "a.txt", "changed, not staged\n");
    write(dir, "staged.txt", "v2\n");
    git(dir, "add", "staged.txt");
    write(dir, "staged.txt", "v3, after staging\n");
    write(dir, "src/new.ts", "export const fresh = 1;\n"); // What agents mostly produce.
    rmSync(join(dir, "gone.txt"));

    const before = untouched(dir);
    const result = await createCheckpoint(dir, options({ now: 1_700_000_000_000 }));
    expect(untouched(dir)).toEqual(before);

    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    const { checkpoint } = result;
    expect(checkpoint).toMatchObject({
      ref: `${CHECKPOINT_REFS}/main/1700000000000`,
      time: 1_700_000_000,
      reason: "before claude",
      worktree: "main",
    });
    const show = (path: string) => git(dir, "show", `${checkpoint.hash}:${path}`);
    // The working tree as it is, not as staged.
    expect(show("a.txt")).toBe("changed, not staged\n");
    expect(show("staged.txt")).toBe("v3, after staging\n");
    expect(show("src/new.ts")).toBe("export const fresh = 1;\n");
    expect(git(dir, "ls-tree", "-r", "--name-only", checkpoint.hash)).not.toContain("gone.txt");
    expect(git(dir, "rev-parse", `${checkpoint.hash}^`)).toBe(before.head);
    expect(git(dir, "log", "-1", "--format=%s", checkpoint.hash).trim()).toBe("GitKit checkpoint: before claude");
  });

  it("leaves out what git ignores", async () => {
    const dir = makeRepo();
    commit(dir, "ignore", { ".gitignore": "node_modules/\n.env\n" });
    write(dir, "node_modules/pkg/index.js", "x");
    write(dir, ".env", "SECRET=1\n");
    write(dir, "kept.txt", "y");
    const result = await createCheckpoint(dir, options());
    expect(
      result.kind === "saved" && git(dir, "ls-tree", "-r", "--name-only", result.checkpoint.hash).split("\n"),
    ).toEqual([".gitignore", "a.txt", "kept.txt", ""]);
  });

  it("leaves out files over the size limit without ever storing them", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "huge model.bin"), Buffer.alloc(2 * MB, 7));
    write(dir, "small.txt", "fine\n");
    const result = await createCheckpoint(dir, options({ maxFileBytes: MB }));
    expect(result.kind === "saved" && result.skipped).toEqual(["huge model.bin"]);
    // Not just left out of the snapshot: its contents never reached the object store.
    const blob = git(dir, "hash-object", "huge model.bin").trim();
    expect(() => git(dir, "cat-file", "-e", blob)).toThrow();
    expect(result.kind === "saved" && git(dir, "show", `${result.checkpoint.hash}:small.txt`)).toBe("fine\n");
  });

  it("saves nothing when nothing changed since the last commit", async () => {
    const dir = makeRepo();
    expect(await createCheckpoint(dir, options())).toEqual({ kind: "unchanged" });
    expect(await listCheckpoints(dir)).toEqual([]);
  });

  it("works before the first commit, and without a git identity", async () => {
    const dir = initRepo(join(tempDir(), "fresh"));
    git(dir, "config", "--unset", "user.name");
    git(dir, "config", "--unset", "user.email");
    write(dir, "first.txt", "hello\n");
    const result = await createCheckpoint(dir, options());
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(git(dir, "show", `${result.checkpoint.hash}:first.txt`)).toBe("hello\n");
    expect(git(dir, "log", "-1", "--format=%P", result.checkpoint.hash).trim()).toBe("");
  });

  it("keeps the newest few and drops old ones, so they don't keep files alive forever", async () => {
    const dir = makeRepo();
    const day = 86_400_000;
    const start = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      write(dir, "a.txt", `edit ${i}\n`);
      await createCheckpoint(dir, options({ reason: `edit ${i}`, keep: 3, maxAgeDays: 30, now: start + i * 1000 }));
    }
    expect((await listCheckpoints(dir)).map((c) => c.reason)).toEqual(["edit 4", "edit 3", "edit 2"]);

    write(dir, "a.txt", "much later\n");
    await createCheckpoint(dir, options({ reason: "later", keep: 3, maxAgeDays: 30, now: start + 31 * day }));
    expect((await listCheckpoints(dir)).map((c) => c.reason)).toEqual(["later"]);
  });

  it("keeps each worktree's checkpoints apart, and finds those of removed worktrees", async () => {
    const dir = makeRepo();
    const tree = join(tempDir(), "agent");
    git(dir, "worktree", "add", "-q", "-b", "agent/x", tree);
    expect(await worktreeId(dir)).toBe("main");
    expect(await worktreeId(tree)).toBe("agent");

    write(dir, "a.txt", "main edit\n");
    write(tree, "a.txt", "agent edit\n");
    await createCheckpoint(dir, options({ reason: "in main" }));
    await createCheckpoint(tree, options({ reason: "in agent" }));

    expect((await readCheckpointState(dir)).checkpoints.map((c) => c.reason)).toEqual(["in main"]);
    expect((await readCheckpointState(tree)).checkpoints.map((c) => c.reason)).toEqual(["in agent"]);
    expect((await readCheckpointState(dir)).removedCheckpoints).toEqual([]);

    git(dir, "worktree", "remove", "--force", tree);
    const removed = (await readCheckpointState(dir)).removedCheckpoints;
    expect(removed.map((c) => [c.worktree, c.reason])).toEqual([["agent", "in agent"]]);
    expect(git(dir, "show", `${removed[0].hash}:a.txt`)).toBe("agent edit\n");
  });
});

describe("parseCheckpoints and checkpointsToDrop", () => {
  const cp = (worktree: string, ms: number, reason = "r"): string =>
    [`${CHECKPOINT_REFS}/${worktree}/${ms}`, `h${ms}`, `GitKit checkpoint: ${reason}`].join("\x1f");

  it("reads refs newest first, with nested worktree names and odd subjects", () => {
    const out = [cp("main", 1000), cp("agent", 3000, "before codex"), cp("main", 2000)].join("\n") + "\n";
    expect(parseCheckpoints(out).map((c) => [c.worktree, c.time, c.reason])).toEqual([
      ["agent", 3, "before codex"],
      ["main", 2, "r"],
      ["main", 1, "r"],
    ]);
    expect(parseCheckpoints(`${CHECKPOINT_REFS}/main/abc\x1fh\x1fx\n`)).toEqual([]);
  });

  it("drops past the newest `keep`, and anything older than the age limit", () => {
    const list = [5, 4, 3, 2, 1].map((t) => ({ time: t * 86_400 }) as Checkpoint);
    const now = 6 * 86_400 * 1000;
    expect(checkpointsToDrop(list, 3, 365, now).map((c) => c.time / 86_400)).toEqual([2, 1]);
    expect(checkpointsToDrop(list, 10, 3, now).map((c) => c.time / 86_400)).toEqual([2, 1]);
    expect(checkpointsToDrop(list, 10, 365, now)).toEqual([]);
  });
});

describe("agentCommand", () => {
  const agents = ["claude", "codex", "aider", "gemini"];
  it.each([
    ["claude", "claude"],
    ["claude --continue", "claude"],
    ["ANTHROPIC_LOG=debug claude -p 'fix it'", "claude"],
    ["npx @anthropic-ai/claude-code", "claude"],
    ["pnpm dlx codex", "codex"],
    ["npx -y codex", "codex"],
    ["/usr/local/bin/aider --model x", "aider"],
    ["C:\\tools\\Aider.exe", "aider"],
    ['"C:\\Program Files\\gemini\\gemini.cmd" --yolo', "gemini"],
    ["& 'C:\\Program Files\\claude.exe'", "claude"],
    ["gemini.ps1", "gemini"],
  ])("%s → %s", (line, agent) => {
    expect(agentCommand(line, agents)).toBe(agent);
  });

  it.each(["git commit -m claude", "cat claude-notes.txt", "claudette", "echo codex", "", "npx"])(
    "ignores %j",
    (line) => {
      expect(agentCommand(line, agents)).toBeNull();
    },
  );
});
