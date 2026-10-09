import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { importWorkflow } from "../../src/workflow/import";
import {
  cronFor,
  describeSchedule,
  newJob,
  scheduleSpec,
  stepsFor,
  toOwnSteps,
  validate,
  type WorkflowModel,
} from "../../src/workflow/model";
import { toYaml } from "../../src/workflow/yaml";

/**
 * What GitHub would see. Spellings GitHub treats as identical are normalized first:
 * `on: push` is `on: { push: null }`, and `needs: build` is `needs: [build]`.
 */
function meaning(workflow: Record<string, unknown>): Record<string, unknown> {
  const on = workflow.on;
  const events =
    typeof on === "string" ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((e) => [e, null])) : on;
  const jobs = Object.fromEntries(
    Object.entries(workflow.jobs as Record<string, Record<string, unknown>>).map(([id, job]) => [
      id,
      job.needs === undefined ? job : { ...job, needs: [job.needs].flat() },
    ]),
  );
  return { ...workflow, on: events, jobs };
}
const roundTrip = (text: string) => meaning(parse(toYaml(importWorkflow(text, "x.yml"))));
const original = (text: string) => meaning(parse(text));

const realWorld = {
  "CI with a matrix, services and env": `
name: CI
on:
  push:
    branches: [main]
  pull_request:
env:
  FORCE_COLOR: "1"
jobs:
  test:
    runs-on: \${{ matrix.os }}
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [22, 24]
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v5
      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version: \${{ matrix.node }}
      - run: npm ci
      - run: npm test
        env:
          REDIS_URL: redis://localhost:6379
      - name: Coverage
        if: matrix.os == 'ubuntu-latest'
        run: |
          npm run coverage
          npx codecov
`,
  "path filters and extra events": `
name: Docs
on:
  push:
    branches: [main]
    paths: ["docs/**"]
  release:
    types: [published]
permissions:
  contents: write
  pages: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: make docs
  deploy:
    needs: build
    runs-on: [self-hosted, linux]
    environment: production
    steps:
      - run: ./deploy.sh
`,
  "reusable workflows and defaults": `
name: Release
on: workflow_dispatch
defaults:
  run:
    working-directory: app
jobs:
  checks:
    uses: ./.github/workflows/ci.yml
    secrets: inherit
  publish:
    needs: [checks]
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`,
};

describe("importWorkflow", () => {
  for (const [name, text] of Object.entries(realWorld)) {
    it(`round-trips: ${name}`, () => {
      expect(roundTrip(text)).toEqual(original(text));
    });
  }

  it("turns jobs into editable nodes linked by needs", () => {
    const model = importWorkflow(realWorld["path filters and extra events"], "docs.yml");
    expect(model.jobs.map((j) => [j.id, j.template, j.needs])).toEqual([
      ["build", "steps", []],
      ["deploy", "steps", ["build"]],
    ]);
    expect(model.jobs[0].steps).toEqual([{ uses: "actions/checkout@v5" }, { run: "make docs" }]);
    expect(model.jobs[1].extra).toEqual({ environment: "production", "runs-on": ["self-hosted", "linux"] });
  });

  it("maps simple triggers to chips and keeps anything fancier as written", () => {
    const ci = importWorkflow(realWorld["CI with a matrix, services and env"], "ci.yml");
    expect(ci.rawOn).toBeUndefined();
    expect(ci.triggers.push).toEqual({ enabled: true, branches: ["main"] });
    expect(ci.triggers.pullRequest.enabled).toBe(true);

    const docs = importWorkflow(realWorld["path filters and extra events"], "docs.yml");
    expect(docs.rawOn).toEqual({ push: { branches: ["main"], paths: ["docs/**"] }, release: { types: ["published"] } });

    const release = importWorkflow(realWorld["reusable workflows and defaults"], "release.yml");
    expect(release.rawOn).toBeUndefined();
    expect(release.triggers.manual).toBe(true);
  });

  it("recognises Studio's own safety defaults instead of treating them as extras", () => {
    const studio = toYaml(newJobWorkflow());
    const model = importWorkflow(studio, "ci.yml");
    expect(model.readOnlyPermissions).toBe(true);
    expect(model.cancelSuperseded).toBe(true);
    expect(model.extra).toBeUndefined();
  });

  it("accepts imported workflows as valid, including reusable-workflow jobs", () => {
    for (const text of Object.values(realWorld)) {
      expect(validate(importWorkflow(text, "x.yml"))).toEqual([]);
    }
  });

  it("rejects files that aren't workflows", () => {
    expect(() => importWorkflow("- just\n- a list\n", "x.yml")).toThrow(/isn't a workflow/);
  });
});

describe("own steps", () => {
  it("converts a template job into the same steps, which can then be edited", () => {
    const test = newJob("node-test", []);
    const own = toOwnSteps(test);
    expect(own.template).toBe("steps");
    expect(own.steps).toEqual(stepsFor(test));
    // Same YAML before and after conversion.
    const wf = (job: typeof test): WorkflowModel => ({ ...newJobWorkflow(), jobs: [job] });
    expect(parse(toYaml(wf(own))).jobs).toEqual(parse(toYaml(wf(test))).jobs);
  });

  it("starts new step jobs with a checkout and a command", () => {
    expect(newJob("steps", []).steps).toEqual([
      { uses: "actions/checkout@v7" },
      { name: "Run a command", run: "echo hello" },
    ]);
  });

  it("explains steps that are missing a command or an action, and leaves out empty fields", () => {
    const job = { ...newJob("steps", []), steps: [{ name: "Half done", run: "", with: {} }] };
    const model = { ...newJobWorkflow(), jobs: [job] };
    expect(validate(model).map((p) => p.message)).toEqual(["New job, step 1: add a command or an action."]);
    expect(parse(toYaml(model)).jobs.job.steps).toEqual([{ name: "Half done" }]);
  });
});

describe("schedules picked from lists", () => {
  it.each([
    [{ frequency: "hourly", minute: 15, hour: 0, weekday: 0, day: 1 }, "15 * * * *", "every hour at :15"],
    [{ frequency: "daily", minute: 0, hour: 6, weekday: 0, day: 1 }, "0 6 * * *", "every day at 06:00 UTC"],
    [{ frequency: "weekly", minute: 30, hour: 9, weekday: 1, day: 1 }, "30 9 * * 1", "every Monday at 09:30 UTC"],
    [
      { frequency: "monthly", minute: 0, hour: 2, weekday: 0, day: 3 },
      "0 2 3 * *",
      "on the 3rd of every month at 02:00 UTC",
    ],
  ] as const)("%o → %s", (spec, cron, text) => {
    expect(cronFor(spec)).toBe(cron);
    expect(scheduleSpec(cron)).toMatchObject({ frequency: spec.frequency, minute: spec.minute });
    expect(describeSchedule(cron)).toBe(text);
  });

  it("treats anything fancier as a custom schedule", () => {
    expect(scheduleSpec("*/5 * * * *")).toBeNull();
    expect(scheduleSpec("0 6 * 1 *")).toBeNull();
    expect(describeSchedule("0 9-17 * * 1-5")).toBe('on schedule "0 9-17 * * 1-5"');
  });
});

function newJobWorkflow(): WorkflowModel {
  return {
    name: "CI",
    file: "ci.yml",
    triggers: {
      push: { enabled: true, branches: ["main"] },
      pullRequest: { enabled: false, branches: [] },
      tags: { enabled: false, pattern: "v*" },
      schedule: { enabled: false, cron: "0 6 * * *" },
      manual: false,
    },
    jobs: [newJob("node-lint", [])],
    readOnlyPermissions: true,
    cancelSuperseded: true,
  };
}
