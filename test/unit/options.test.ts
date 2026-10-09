import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { applyOn } from "../../src/workflow/import";
import {
  ACTIONS,
  STEP_GROUPS,
  STEP_PRESETS,
  addPreset,
  newJob,
  validate,
  type Step,
  type WorkflowModel,
} from "../../src/workflow/model";
import {
  getPath,
  isEmpty,
  levelsFor,
  matrixRows,
  parseYamlMapping,
  scalar,
  serviceRows,
  setPath,
  toYamlText,
  withMatrix,
  withServices,
} from "../../src/workflow/options";
import { toYaml } from "../../src/workflow/yaml";

const workflow = (overrides: Partial<WorkflowModel> = {}): WorkflowModel => ({
  name: "CI",
  file: "ci.yml",
  triggers: {
    push: { enabled: true, branches: ["main"] },
    pullRequest: { enabled: false, branches: [] },
    tags: { enabled: false, pattern: "v*" },
    schedule: { enabled: false, cron: "0 6 * * *" },
    manual: false,
  },
  jobs: [newJob("steps", [])],
  readOnlyPermissions: true,
  cancelSuperseded: true,
  ...overrides,
});

describe("setPath and getPath", () => {
  it("creates nested keys and reads them back", () => {
    const extra = setPath(undefined, ["defaults", "run", "working-directory"], "app");
    expect(extra).toEqual({ defaults: { run: { "working-directory": "app" } } });
    expect(getPath(extra, ["defaults", "run", "working-directory"])).toBe("app");
    expect(getPath(extra, ["defaults", "nope", "x"])).toBeUndefined();
  });

  it("removes cleared values and the objects they leave empty, so the YAML has no leftovers", () => {
    const extra = { env: { A: "1" }, defaults: { run: { "working-directory": "app" } } };
    expect(setPath(structuredClone(extra), ["defaults", "run", "working-directory"], "")).toEqual({ env: { A: "1" } });
    expect(setPath({ env: {} }, ["env"], {})).toBeUndefined();
    expect(setPath({ a: 1 }, ["b"], [])).toEqual({ a: 1 });
  });

  it.each([
    [undefined, true],
    ["", true],
    [[], true],
    [{}, true],
    [0, false],
    [false, false],
    ["x", false],
  ])("isEmpty(%j) → %s", (value, empty) => {
    expect(isEmpty(value)).toBe(empty);
  });

  it.each([
    ["true", true],
    ["false", false],
    ["15", 15],
    ["-3", -3],
    ["3.10", "3.10"],
    ["007", "007"],
    ["hello", "hello"],
  ])("stores %j as %j", (text, value) => {
    expect(scalar(text)).toBe(value);
  });
});

describe("matrix rows", () => {
  it("reads and writes variables as comma-separated values, keeping what rows can't show", () => {
    const strategy = {
      "fail-fast": false,
      matrix: { os: ["ubuntu-latest", "windows-latest"], node: [22, 24], include: [{ os: "macos-latest" }] },
    };
    expect(matrixRows(strategy)).toEqual([
      { name: "os", values: "ubuntu-latest, windows-latest" },
      { name: "node", values: "22, 24" },
    ]);
    expect(
      withMatrix(strategy, [
        { name: "node", values: "22, 24, 26" },
        { name: "", values: "ignored" },
      ]),
    ).toEqual({
      "fail-fast": false,
      matrix: { include: [{ os: "macos-latest" }], node: [22, 24, 26] },
    });
  });

  it("keeps version strings like 3.10 as strings, and clears the matrix when the rows are empty", () => {
    expect(withMatrix(undefined, [{ name: "python", values: "3.10, 3.13" }])).toEqual({
      matrix: { python: ["3.10", "3.13"] },
    });
    expect(withMatrix({ matrix: { os: ["a"] } }, [])).toBeUndefined();
    expect(withMatrix({ matrix: { os: ["a"] } }, [{ name: "os", values: " , " }])).toBeUndefined();
  });
});

describe("service rows", () => {
  it("reads and writes services, keeping their other settings", () => {
    const services = { postgres: { image: "postgres:17", ports: ["5432:5432"], env: { POSTGRES_PASSWORD: "x" } } };
    expect(serviceRows(services)).toEqual([{ name: "postgres", image: "postgres:17", ports: "5432:5432" }]);
    expect(
      withServices(services, [
        { name: "postgres", image: "postgres:18", ports: "5432:5432, 5433:5433" },
        { name: "redis", image: "redis:8", ports: "" },
      ]),
    ).toEqual({
      postgres: { image: "postgres:18", ports: ["5432:5432", "5433:5433"], env: { POSTGRES_PASSWORD: "x" } },
      redis: { image: "redis:8" },
    });
    expect(withServices(services, [{ name: " ", image: "x", ports: "" }])).toBeUndefined();
  });

  it("knows id-token can only be granted, not read", () => {
    expect(levelsFor("id-token")).toEqual(["none", "write"]);
    expect(levelsFor("contents")).toEqual(["none", "read", "write"]);
  });
});

describe("YAML escape hatch", () => {
  it("accepts mappings, clears on empty text, and explains what's wrong otherwise", () => {
    expect(parseYamlMapping("concurrency:\n  group: deploy\n")).toEqual({
      value: { concurrency: { group: "deploy" } },
    });
    expect(parseYamlMapping("  ")).toEqual({ value: undefined });
    expect(parseYamlMapping("- a\n- b")).toEqual({ error: "Write keys and values, like  name: value" });
    expect("error" in parseYamlMapping("a: [unclosed")).toBe(true);
  });

  it("shows nothing for nothing, and round-trips what it shows", () => {
    expect(toYamlText(undefined)).toBe("");
    const value = { outputs: { version: "${{ steps.v.outputs.version }}" } };
    expect(parseYamlMapping(toYamlText(value))).toEqual({ value });
  });

  it("turns triggers typed as YAML into chips when they fit, and keeps the rest as written", () => {
    const model = workflow();
    applyOn(model, { pull_request: { branches: ["main"] }, workflow_dispatch: null });
    expect(model.rawOn).toBeUndefined();
    expect(model.triggers.pullRequest).toEqual({ enabled: true, branches: ["main"] });
    expect(model.triggers.push.enabled).toBe(false);

    applyOn(model, { release: { types: ["published"] } });
    expect(model.rawOn).toEqual({ release: { types: ["published"] } });
    expect(parse(toYaml(model)).on).toEqual({ release: { types: ["published"] } });
  });
});

describe("ready-made steps", () => {
  it("are all valid once added, pinned to a version, and in a known group", () => {
    for (const [key, preset] of Object.entries(STEP_PRESETS)) {
      expect(STEP_GROUPS).toContain(preset.group);
      for (const step of preset.steps) if (step.uses) expect(step.uses, key).toMatch(/@/);
      // "Run a command" and "Use an action" start blank on purpose; validation asks to fill them in.
      if (key === "run" || key === "action") continue;
      const job = { ...newJob("steps", []), steps: [] as Step[] };
      addPreset(job, key, true);
      expect(validate(workflow({ jobs: [job] })), key).toEqual([]);
    }
  });

  it("adds several steps at once when they belong together", () => {
    const job = { ...newJob("steps", []), steps: [] as Step[] };
    expect(addPreset(job, "pages", true).first).toBe(0);
    expect(job.steps.map((s) => s.uses)).toEqual([ACTIONS.pagesConfigure, ACTIONS.pagesUpload, ACTIONS.pagesDeploy]);
  });

  it("grants the access a step needs to its job only, keeping read access to the code", () => {
    const job = newJob("steps", []);
    expect(addPreset(job, "release", true).granted).toEqual(["contents (write)"]);
    expect(job.extra?.permissions).toEqual({ contents: "write" });
    expect(addPreset(job, "pr-comment", true).granted).toEqual(["pull-requests (write)"]);
    expect(job.extra?.permissions).toEqual({ contents: "write", "pull-requests": "write" });
    // Already granted: nothing new to say.
    expect(addPreset(job, "release", true).granted).toEqual([]);

    const other = newJob("steps", []);
    addPreset(other, "pages", true);
    expect(other.extra?.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    const yaml = parse(toYaml(workflow({ jobs: [other] })));
    expect(yaml.permissions).toEqual({ contents: "read" });
    expect(yaml.jobs.job.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
  });
});
