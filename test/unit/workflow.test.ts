import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  describeTriggers,
  goals,
  newJob,
  stages,
  suggestWorkflow,
  validate,
  type WorkflowModel,
} from "../../src/workflow/model";
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
    expect(data.jobs.test.strategy).toEqual({ matrix: { "node-version": ["22", "24"] } });
    expect(data.jobs.test.steps[1]).toEqual({
      uses: "actions/setup-node@v7",
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

describe("goals", () => {
  const facts = {
    files: ["package.json", "Dockerfile"],
    npmScripts: { lint: "x", test: "y", build: "z" },
    defaultBranch: "main",
  };
  const byId = Object.fromEntries(goals(facts).map((g) => [g.id, g]));

  it("recommends what fits the project", () => {
    expect(byId.check.recommended).toBe(true);
    expect(byId.docker.recommended).toBe(true);
    expect(byId.release.recommended).toBe(false);
  });

  it("builds a valid workflow for every goal except the blank one", () => {
    for (const goal of goals(facts)) {
      const expected = goal.id === "blank" ? ["Add at least one job."] : [];
      expect(
        validate(goal.model).map((p) => p.message),
        goal.id,
      ).toEqual(expected);
    }
  });

  it("grants extra permissions only to the job that needs them", () => {
    const docker = parse(toYaml(byId.docker.model));
    expect(docker.permissions).toEqual({ contents: "read" });
    expect(docker.jobs["publish-image"].permissions).toEqual({ contents: "read", packages: "write" });
    expect(docker.on).toEqual({ push: { tags: ["v*"] }, workflow_dispatch: null });

    const pages = parse(toYaml(byId.pages.model));
    expect(pages.jobs["deploy-pages"].permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(pages.jobs["deploy-pages"].environment.name).toBe("github-pages");
    const names = pages.jobs["deploy-pages"].steps.map((s: { name?: string; uses?: string }) => s.name ?? s.uses);
    expect(names).toContain("Build");
  });

  it("skips the optional build step when there's nothing to build", () => {
    const plain = goals({ files: [] }).find((g) => g.id === "pages")!;
    const steps = parse(toYaml(plain.model)).jobs["deploy-pages"].steps as { name?: string }[];
    expect(steps.some((s) => s.name === "Build")).toBe(false);
  });

  it("releases with the gh CLI, no third-party action", () => {
    const release = parse(toYaml(byId.release.model)).jobs.release;
    // Creating a release needs write access to contents, for this job only.
    expect(release.permissions).toEqual({ contents: "write" });
    expect(release.steps[1].run).toBe('gh release create "$GITHUB_REF_NAME" --generate-notes');
  });
});

describe("plain-English triggers", () => {
  it("reads triggers as sentence parts", () => {
    expect(describeTriggers(node.triggers)).toEqual([
      "on pushes to main",
      "on pull requests",
      "when you click Run on GitHub",
    ]);
    const several = { ...node.triggers, push: { enabled: true, branches: ["main", "dev", "release"] }, manual: false };
    expect(describeTriggers(several)[0]).toBe("on pushes to main, dev or release");
    expect(describeSchedule("0 6 * * 1")).toBe("every Monday at 06:00 UTC");
    expect(describeSchedule("*/5 * * * *")).toBe('on schedule "*/5 * * * *"');
  });
});
