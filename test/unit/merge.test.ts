import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importWorkflow } from "../../src/workflow/import";
import { updateYaml } from "../../src/workflow/merge";
import type { WorkflowModel } from "../../src/workflow/model";
import { workflowObject } from "../../src/workflow/yaml";

const original = readFileSync(join(__dirname, "../fixtures/workflows/hand-written.yml"), "utf8");

/** Opens the file in Studio, changes something, and saves it back. */
function edit(change: (model: WorkflowModel) => void, text = original): string {
  const model = importWorkflow(text, "ci.yml");
  change(model);
  const saved = updateYaml(text, workflowObject(model));
  if (saved === null) throw new Error("not merged");
  // However it's written, the saved file must mean exactly what the model says: opened again, it's
  // the same workflow.
  expect(workflowObject(importWorkflow(saved, "ci.yml"))).toEqual(workflowObject(model));
  return saved;
}

/** Lines in `after` that aren't in `before`, and the other way round. */
function diff(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  return { added: b.filter((l) => !a.includes(l)), removed: a.filter((l) => !b.includes(l)) };
}

describe("updateYaml", () => {
  it("leaves the file exactly as it was when nothing changed", () => {
    expect(edit(() => {})).toBe(original);
  });

  it("changes only the line that changed, keeping comments, quotes and block scripts", () => {
    const saved = edit((m) => {
      m.jobs[0].steps![2].run = "npm ci --no-audit";
    });
    expect(diff(original, saved)).toEqual({
      added: ["      - run: npm ci --no-audit"],
      removed: ["      - run: npm ci"],
    });
    expect(saved).toContain("# CI for the storefront. Keep this fast: under five minutes.");
    expect(saved).toContain("node: [22, 24] # the two LTS lines we support");
    expect(saved).toContain("name: 'Deploy to Pages'");
    expect(saved).toContain("run: |\n          npm test -- --reporter=dot");
  });

  it("adds a step in the middle without disturbing the steps around it or their comments", () => {
    const saved = edit((m) => {
      m.jobs[0].steps!.splice(3, 0, { name: "Lint", run: "npm run lint" });
    });
    expect(diff(original, saved).removed).toEqual([]);
    expect(saved).toContain(
      "      - run: npm ci\n      - name: Lint\n        run: npm run lint\n      - name: Unit tests",
    );
    expect(saved).toContain("      # Cache is keyed on the lockfile.\n      - uses: actions/setup-node@v7");
  });

  it("removes a job, and adds a condition where it belongs", () => {
    const saved = edit((m) => {
      m.jobs[1].extra = { ...m.jobs[1].extra, if: "github.ref == 'refs/heads/main'" };
    });
    expect(diff(original, saved)).toEqual({ added: ["    if: github.ref == 'refs/heads/main'"], removed: [] });

    const without = edit((m) => {
      m.jobs = m.jobs.filter((j) => j.id !== "deploy");
    });
    expect(without).not.toContain("deploy:");
    expect(without).toContain("# Read-only unless a job says otherwise.");
  });

  it("keeps short forms that mean the same: needs: [test] and on: [push]", () => {
    expect(edit(() => {})).toContain("needs: [test]");
    const short =
      "on: [push, pull_request]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    expect(edit((m) => (m.name = "Checks"), short)).toBe(`name: Checks\n${short}`);
  });

  it("follows the file's own indentation", () => {
    const four = "jobs:\n    a:\n        runs-on: ubuntu-latest\n        steps:\n        -   run: echo one\n";
    const saved = edit((m) => m.jobs[0].steps!.push({ run: "echo two" }), `on: push\n${four}`);
    expect(saved).toContain("    a:\n        runs-on: ubuntu-latest");
    expect(saved).toMatch(/run: echo one\n\s+- run: echo two\n$/);
  });

  it("keeps an unnamed workflow unnamed, and the file's opening comment on top when a name is given", () => {
    const unnamed =
      "# Checks every push.\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo a\n";
    // Studio shows "ci" for it, but writing name: ci would change how GitHub lists the workflow.
    expect(edit(() => {}, unnamed)).toBe(unnamed);
    expect(edit((m) => (m.name = "Checks"), unnamed)).toBe(
      unnamed.replace("# Checks every push.\n", "# Checks every push.\nname: Checks\n"),
    );
  });

  it("refuses only what isn't YAML at all, so the caller rewrites it instead", () => {
    expect(updateYaml("jobs: [unclosed", { jobs: {} })).toBeNull();
  });
});

describe("updateYaml with anchors", () => {
  // One env block written once (&shared) and reused (*shared): GitHub reads both jobs as having it.
  const anchored = [
    "# Shared setup for both jobs.",
    "name: CI",
    "on: push",
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    env: &shared",
    "      CI: 'true' # some tools read it as a string",
    "      NODE_ENV: test",
    "    steps:",
    "      - run: echo a",
    "  b:",
    "    runs-on: ubuntu-latest",
    "    env: *shared",
    "    steps:",
    "      - run: echo b",
    "",
  ].join("\n");
  const read = (text: string) => importWorkflow(text, "ci.yml");

  it("keeps anchors, aliases and comments when they aren't what changed", () => {
    expect(edit(() => {}, anchored)).toBe(anchored);
    const saved = edit((m) => (m.jobs[1].steps![0].run = "echo bee"), anchored);
    expect(diff(anchored, saved)).toEqual({ added: ["      - run: echo bee"], removed: ["      - run: echo b"] });
  });

  it("changes only the reused spot when that's what was edited, leaving the original alone", () => {
    const saved = edit((m) => (m.jobs[1].extra!.env = { CI: "true", NODE_ENV: "production" }), anchored);
    expect(saved).toContain("    env: &shared\n      CI: 'true' # some tools read it as a string");
    expect(saved).not.toContain("*shared");
    expect(read(saved).jobs[0].extra!.env).toEqual({ CI: "true", NODE_ENV: "test" });
    expect(read(saved).jobs[1].extra!.env).toEqual({ CI: "true", NODE_ENV: "production" });
  });

  it("keeps a job's aliases working when the job holding the anchor is removed", () => {
    const saved = edit((m) => (m.jobs = m.jobs.filter((j) => j.id !== "a")), anchored);
    expect(saved).not.toContain("  a:");
    expect(saved).not.toContain("*shared");
    expect(read(saved).jobs[0].extra!.env).toEqual({ CI: "true", NODE_ENV: "test" });
  });

  it("keeps aliases working when the step holding the anchor is removed", () => {
    const steps = [
      "on: push",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - &checkout",
      "        uses: actions/checkout@v7",
      "      - run: echo a",
      "  b:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - *checkout",
      "      - run: echo b",
      "",
    ].join("\n");
    const saved = edit((m) => m.jobs[0].steps!.splice(0, 1), steps);
    expect(read(saved).jobs[1].steps![0]).toEqual({ uses: "actions/checkout@v7" });
  });

  it("gives the other uses their own copy before the anchored original is edited", () => {
    const saved = edit((m) => (m.jobs[0].extra!.env = { CI: "true", NODE_ENV: "staging" }), anchored);
    expect(read(saved).jobs[0].extra!.env).toEqual({ CI: "true", NODE_ENV: "staging" });
    expect(read(saved).jobs[1].extra!.env).toEqual({ CI: "true", NODE_ENV: "test" });
    expect(saved).toContain("# Shared setup for both jobs.");
    expect(saved).toContain("# some tools read it as a string");
  });
});
