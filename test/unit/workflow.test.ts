import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { newJob, stages, suggestWorkflow, validate, type WorkflowModel } from "../../src/workflow/model";
import { explain, readModel, toYaml } from "../../src/workflow/yaml";

const node = suggestWorkflow({
  files: ["package.json", "Dockerfile"],
  npmScripts: { lint: "eslint .", test: "vitest", build: "tsc" },
  defaultBranch: "main",
});

describe("suggestWorkflow", () => {
  it("builds lint first, then test and build in parallel, plus docker", () => {
    expect(node.jobs.map((j) => [j.id, j.needs])).toEqual([
      ["lint", []],
      ["test", ["lint"]],
      ["build", ["lint"]],
      ["docker", []],
    ]);
    expect(node.triggers.push).toEqual({ enabled: true, branches: ["main"] });
  });

  it("skips npm's placeholder test script and picks pip install from the files present", () => {
    const placeholder = suggestWorkflow({
      files: ["package.json"],
      npmScripts: { test: 'echo "Error: no test specified"' },
    });
    expect(placeholder.jobs.map((j) => j.id)).toEqual(["custom"]);
    const py = suggestWorkflow({ files: ["pyproject.toml"] });
    expect(py.jobs.find((j) => j.template === "python-test")?.inputs.install).toBe('pip install -e ".[dev]"');
  });
});

describe("validate", () => {
  it("accepts the suggestion", () => {
    expect(validate(node)).toEqual([]);
  });

  it("catches missing triggers, bad cron, unknown needs and cycles", () => {
    const broken: WorkflowModel = structuredClone(node);
    broken.triggers = {
      ...broken.triggers,
      push: { enabled: false, branches: [] },
      pullRequest: { enabled: false, branches: [] },
      manual: false,
    };
    broken.jobs[0].needs = ["build"]; // lint → build → lint
    broken.jobs[1].needs = ["nope"];
    const messages = validate(broken).map((p) => p.message);
    expect(messages).toContain("Pick at least one trigger, or the workflow never runs.");
    expect(messages).toContain('Runs after "nope", which doesn\'t exist.');
    expect(messages.some((m) => m.startsWith("These jobs wait on each other forever"))).toBe(true);

    const cron: WorkflowModel = structuredClone(node);
    cron.triggers.schedule = { enabled: true, cron: "0 6 *" };
    expect(validate(cron).map((p) => p.message)).toContain(
      "A schedule needs 5 cron fields: minute hour day month weekday.",
    );
  });
});

describe("stages", () => {
  it("groups jobs that can run together", () => {
    expect(stages(node.jobs)).toEqual([
      ["lint", "docker"],
      ["test", "build"],
    ]);
  });
});

describe("toYaml", () => {
  const yaml = toYaml(node);
  const data = parse(yaml);

  it("writes a valid workflow with least-privilege defaults", () => {
    expect(data.name).toBe("CI");
    expect(data.on).toEqual({ push: { branches: ["main"] }, pull_request: null, workflow_dispatch: null });
    expect(data.permissions).toEqual({ contents: "read" });
    expect(data.concurrency["cancel-in-progress"]).toBe(true);
    expect(Object.keys(data.jobs)).toEqual(["lint", "docker", "test", "build"]);
  });

  it("writes the test matrix and wires the version into setup", () => {
    expect(data.jobs.test.needs).toBe("lint");
    expect(data.jobs.test.strategy).toEqual({ matrix: { "node-version": ["20", "22"] } });
    expect(data.jobs.test.steps[1]).toEqual({
      uses: "actions/setup-node@v4",
      with: { "node-version": "${{ matrix.node-version }}", cache: "npm" },
    });
  });

  it("prints bare event keys like a person would", () => {
    expect(yaml).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(yaml).not.toMatch(/workflow_dispatch: null/);
  });

  it("writes tags-only pushes without a branch filter", () => {
    const tags: WorkflowModel = structuredClone(node);
    tags.triggers.push.enabled = false;
    tags.triggers.tags = { enabled: true, pattern: "v*" };
    expect(parse(toYaml(tags)).on.push).toEqual({ tags: ["v*"] });
  });
});

describe("readModel", () => {
  it("round-trips a GitKit file and notices hand edits", () => {
    const yaml = toYaml(node);
    expect(readModel(yaml)).toEqual({ model: node, editedByHand: false });
    expect(readModel(yaml.replace("npm ci", "npm install"))?.editedByHand).toBe(true);
    expect(readModel("name: CI\non: push\n")).toBeNull();
  });
});

describe("explain", () => {
  it("reads any workflow into plain English", () => {
    const external = [
      "name: Release",
      "on:",
      "  push:",
      "    tags: ['v*']",
      "  schedule:",
      "    - cron: '0 0 * * 0'",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    strategy:",
      "      matrix:",
      "        os: [linux, mac]",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: Build it",
      "        run: make",
      "  publish:",
      "    needs: build",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      "          npm publish",
      "          echo done",
    ].join("\n");
    expect(explain(external)).toEqual({
      name: "Release",
      triggers: ["on push of tags v*", "on a schedule (0 0 * * 0)"],
      jobs: [
        {
          id: "build",
          name: "build",
          runsOn: "ubuntu-latest",
          needs: [],
          steps: ["actions/checkout@v4", "Build it"],
          matrix: "os: linux, mac",
        },
        {
          id: "publish",
          name: "publish",
          runsOn: "ubuntu-latest",
          needs: ["build"],
          steps: ["npm publish"],
          matrix: null,
        },
      ],
    });
  });

  it("reports YAML errors instead of throwing", () => {
    expect(explain("jobs: [unclosed").error).toBeTruthy();
  });

  it("gives new jobs unique ids", () => {
    const jobs = [newJob("node-test", [])];
    expect(newJob("node-test", jobs).id).toBe("test-2");
  });
});
