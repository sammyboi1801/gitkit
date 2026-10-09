import { describe, expect, it } from "vitest";
import {
  addEvent,
  addVersionTags,
  inputRows,
  newInput,
  outputRows,
  removeEvent,
  scheduleRows,
  secretRows,
  setFilter,
  setKey,
  setTypes,
  splitList,
  withInputs,
  withOutputs,
  withSchedules,
  withSecrets,
} from "../../src/workflow/triggers";

describe("adding and removing events", () => {
  it("adds events with sensible starting options, leaving the others alone", () => {
    const on = { pull_request: { branches: ["main"] } };
    expect(addEvent(on, "push", "trunk")).toEqual({
      pull_request: { branches: ["main"] },
      push: { branches: ["trunk"] },
    });
    expect(addEvent({}, "schedule")).toEqual({ schedule: [{ cron: "0 6 * * *" }] });
    expect(addEvent({}, "workflow_dispatch")).toEqual({ workflow_dispatch: null });
    expect(addEvent({}, "release")).toEqual({ release: { types: ["published"] } });
    expect(removeEvent({ push: null, release: null }, "push")).toEqual({ release: null });
  });

  it("adds version tags to push without turning off branch pushes", () => {
    expect(addVersionTags({})).toEqual({ push: { tags: ["v*"] } });
    expect(addVersionTags({ push: { branches: ["main"] } })).toEqual({ push: { branches: ["main"], tags: ["v*"] } });
    // "Every push" plus tags needs branches: ["**"], or GitHub would only run on tags.
    expect(addVersionTags({ push: null })).toEqual({ push: { branches: ["**"], tags: ["v*"] } });
  });
});

describe("editing an event", () => {
  it("sets a filter to only these, or all except these, replacing the other side", () => {
    expect(setFilter({ branches: ["main"], paths: ["src/**"] }, "branches", "except", ["gh-pages"])).toEqual({
      "branches-ignore": ["gh-pages"],
      paths: ["src/**"],
    });
    expect(setFilter({ branches: ["main"] }, "branches", "only", [" ", ""])).toBeNull();
    expect(setFilter(null, "paths", "only", ["docs/**"])).toEqual({ paths: ["docs/**"] });
  });

  it("writes activity types only when they aren't GitHub's defaults", () => {
    const defaults = ["opened", "synchronize", "reopened"];
    expect(setTypes(null, ["closed"], defaults)).toEqual({ types: ["closed"] });
    expect(
      setTypes({ types: ["closed"], branches: ["main"] }, ["reopened", "opened", "synchronize"], defaults),
    ).toEqual({
      branches: ["main"],
    });
    expect(setTypes({ types: ["closed"] }, null)).toBeNull();
  });

  it("sets any other key, and clearing it removes it", () => {
    expect(setKey({ workflows: ["CI"] }, "workflows", ["CI", "Deploy"])).toEqual({ workflows: ["CI", "Deploy"] });
    expect(setKey({ workflows: ["CI"] }, "workflows", [])).toBeNull();
  });

  it("splits lists on commas and new lines", () => {
    expect(splitList("main, dev\nrelease/*,, ")).toEqual(["main", "dev", "release/*"]);
  });
});

describe("schedules", () => {
  it("reads and writes several schedules, each in its own timezone", () => {
    const rows = scheduleRows([{ cron: "0 6 * * *" }, { cron: "0 9 * * 1", timezone: "Europe/London" }]);
    expect(rows).toEqual([{ cron: "0 6 * * *" }, { cron: "0 9 * * 1", timezone: "Europe/London" }]);
    expect(withSchedules([...rows, { cron: " 0 0 1 * * ", timezone: "UTC" }])).toEqual([
      { cron: "0 6 * * *" },
      { cron: "0 9 * * 1", timezone: "Europe/London" },
      { cron: "0 0 1 * *" },
    ]);
  });
});

describe("inputs", () => {
  it("reads Run-button inputs as rows and writes them back, typed", () => {
    const inputs = {
      environment: {
        description: "Where to deploy",
        type: "choice",
        options: ["staging", "production"],
        required: true,
        default: "staging",
      },
      dry_run: { type: "boolean", default: false },
      replicas: { type: "number", default: 2, deprecationMessage: "Set in the config instead" },
    };
    const rows = inputRows(inputs);
    expect(rows.map((r) => [r.name, r.type, r.default, r.required])).toEqual([
      ["environment", "choice", "staging", true],
      ["dry_run", "boolean", "false", false],
      ["replicas", "number", "2", false],
    ]);
    expect(withInputs(rows)).toEqual({
      environment: {
        description: "Where to deploy",
        required: true,
        type: "choice",
        default: "staging",
        options: ["staging", "production"],
      },
      dry_run: { type: "boolean", default: false },
      replicas: { deprecationMessage: "Set in the config instead", type: "number", default: 2 },
    });
  });

  it("drops unnamed rows, and writes nothing for none", () => {
    expect(withInputs([newInput()])).toBeUndefined();
    expect(withInputs([{ ...newInput("choice"), name: "env" }])).toEqual({
      env: { type: "choice", options: ["staging", "production"] },
    });
  });

  it("reads and writes a reusable workflow's secrets and outputs", () => {
    const secrets = { NPM_TOKEN: { required: true }, OPTIONAL: null };
    expect(withSecrets(secretRows(secrets))).toEqual(secrets);
    const outputs = { version: { description: "The version built", value: "${{ jobs.build.outputs.version }}" } };
    expect(withOutputs(outputRows(outputs))).toEqual({
      version: { value: "${{ jobs.build.outputs.version }}", description: "The version built" },
    });
  });
});
