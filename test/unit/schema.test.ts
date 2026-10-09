import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { STEP_PRESETS, TEMPLATES, addPreset, goals, newJob, type WorkflowModel } from "../../src/workflow/model";
import { schemaProblems } from "../../src/workflow/schema";
import { EVENTS } from "../../src/workflow/events";
import { addVersionTags, newEventConfig, setFilter, withInputs, newInput } from "../../src/workflow/triggers";
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
  it("accepts jobs using every setting Studio has a control for", () => {
    const job = newJob("steps", []);
    job.extra = {
      "runs-on": ["self-hosted", "linux"],
      environment: { name: "production", url: "https://acme.dev" },
      concurrency: { group: "deploy", "cancel-in-progress": true },
      outputs: { version: "${{ steps.v.outputs.version }}" },
      defaults: { run: { shell: "pwsh", "working-directory": "web" } },
      strategy: {
        matrix: { os: ["ubuntu-latest"], include: [{ os: "macos-latest" }], exclude: [{ os: "ubuntu-latest" }] },
        "max-parallel": 2,
      },
    };
    const call = {
      ...newJob("steps", [job]),
      id: "call",
      steps: undefined,
      extra: { uses: "./.github/workflows/deploy.yml", with: { target: "prod" }, secrets: "inherit" },
    };
    const model = {
      ...workflow([job, call]),
      extra: {
        permissions: { contents: "read", issues: "write" },
        concurrency: { group: "ci" },
        defaults: { run: { shell: "bash" } },
      },
    };
    expect(schemaProblems(asGitHubSeesIt(model))).toEqual([]);
  });

  it("accepts every trigger as Studio starts it, and as its options set it", () => {
    for (const { event } of EVENTS) {
      const config = event === "workflow_run" ? { workflows: ["CI"], types: ["completed"] } : newEventConfig(event);
      const model = { ...workflow([newJob("node-test", [])]), rawOn: { [event]: config } };
      expect(schemaProblems(asGitHubSeesIt(model)), event).toEqual([]);
    }
    const rich = {
      ...addVersionTags({ push: setFilter(null, "paths", "except", ["docs/**"]) }),
      pull_request: { types: ["opened", "ready_for_review"], "branches-ignore": ["gh-pages"] },
      schedule: [{ cron: "0 6 * * *" }, { cron: "0 9 * * 1", timezone: "Europe/London" }],
      workflow_dispatch: { inputs: withInputs([{ ...newInput("choice"), name: "target", required: true }]) },
    };
    expect(schemaProblems(asGitHubSeesIt({ ...workflow([newJob("node-test", [])]), rawOn: rich }))).toEqual([]);
  });

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
