import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { STEP_PRESETS, TEMPLATES, addPreset, goals, newJob, type WorkflowModel } from "../../src/workflow/model";
import { schemaProblems } from "../../src/workflow/schema";
import { toYaml } from "../../src/workflow/yaml";

const workflow = (jobs: WorkflowModel["jobs"]): WorkflowModel => ({
  name: "CI",
  file: "ci.yml",
  triggers: {
    push: { enabled: true, branches: ["main"] },
    pullRequest: { enabled: true, branches: [] },
    tags: { enabled: true, pattern: "v*" },
    schedule: { enabled: true, cron: "0 6 * * 1" },
    manual: true,
  },
  jobs,
  readOnlyPermissions: true,
  cancelSuperseded: true,
});
const asGitHubSeesIt = (model: WorkflowModel) => parse(toYaml(model));

describe("GitHub's workflow schema", () => {
  it("accepts every job template Studio offers", () => {
    for (const t of TEMPLATES) {
      const job = newJob(t.id, []);
      expect(schemaProblems(asGitHubSeesIt(workflow([job]))), t.id).toEqual([]);
    }
  });

  it("accepts every ready-made step, filled in", () => {
    for (const key of Object.keys(STEP_PRESETS)) {
      if (key === "run" || key === "action") continue; // Blank until filled in, on purpose.
      const job = { ...newJob("steps", []), steps: [] };
      addPreset(job, key, true);
      expect(schemaProblems(asGitHubSeesIt(workflow([job]))), key).toEqual([]);
    }
  });

  it("accepts every starting goal for a typical project", () => {
    const facts = {
      files: ["package.json", "Dockerfile", "requirements.txt", "go.mod"],
      npmScripts: { lint: "x", test: "y", build: "z" },
      defaultBranch: "main",
    };
    // "Start from scratch" has no jobs yet; Studio's own check stops it being saved like that.
    for (const goal of goals(facts).filter((g) => g.id !== "blank")) {
      expect(schemaProblems(asGitHubSeesIt(goal.model)), goal.id).toEqual([]);
    }
  });

  it("accepts this repo's own CI, which Studio generated", () => {
    const ci = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
    expect(schemaProblems(parse(ci))).toEqual([]);
  });

  it("explains typos and missing keys in plain words, pointing at where they are", () => {
    const broken = {
      name: "CI",
      on: { push: null },
      jobs: {
        test: { runs_on: "ubuntu-latest", steps: [{ run: "npm test" }] },
        lint: { "runs-on": "ubuntu-latest", steps: [{ uses: "actions/checkout@v7" }, { runs: "npm run lint" }] },
      },
    };
    const problems = schemaProblems(broken);
    expect(problems).toContain('jobs › test: GitHub doesn\'t know "runs_on"');
    expect(problems.some((p) => p.startsWith("jobs › lint › steps › 2:"))).toBe(true);
    expect(problems.length).toBeLessThanOrEqual(5);
  });

  it("says when a value has the wrong shape", () => {
    const problems = schemaProblems({
      name: "CI",
      on: "push",
      jobs: { a: { "runs-on": "ubuntu-latest", steps: "npm test" } },
    });
    expect(problems).toEqual(["jobs › a › steps: should be a list"]);
  });
});
