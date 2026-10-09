import { describe, expect, it } from "vitest";
import { EVENTS, describeEvent, filterOf, normalizeOn, typesOf } from "../../src/workflow/events";
import schema from "../../src/workflow/github-workflow.schema.json";

type Node = Record<string, unknown>;

/** Every event GitHub's schema knows, with its activity types and filters. */
function schemaEvents(): Map<string, { types: string[] | null; keys: string[] }> {
  const on = (schema as Node).properties as Node;
  const object = ((on.on as Node).oneOf as Node[]).find((x) => x.properties) as Node;
  const found = new Map<string, { types: string[] | null; keys: string[] }>();
  for (const [event, def] of Object.entries(object.properties as Node)) {
    const acc = { types: null as string[] | null, keys: new Set<string>() };
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      const n = node as Node;
      for (const [key, value] of Object.entries((n.properties ?? {}) as Node)) {
        acc.keys.add(key);
        const items = (value as Node).items as Node | undefined;
        if (key === "types" && items?.enum) acc.types = items.enum as string[];
      }
      ["oneOf", "anyOf", "allOf"].forEach((k) => visit(n[k]));
    };
    visit(def);
    found.set(event, { types: acc.types, keys: [...acc.keys] });
  }
  return found;
}

describe("the event catalog", () => {
  const fromSchema = schemaEvents();

  it("has every event GitHub's schema knows, and nothing it doesn't", () => {
    expect(EVENTS.map((e) => e.event).sort()).toEqual([...fromSchema.keys()].sort());
  });

  it("offers exactly the activity types the schema allows", () => {
    for (const spec of EVENTS) {
      const types = fromSchema.get(spec.event)!.types;
      expect([spec.event, spec.types ?? null]).toEqual([spec.event, types]);
    }
  });

  it("offers the filters GitHub supports for each event", () => {
    for (const spec of EVENTS.filter((e) => e.filters && e.event !== "workflow_run")) {
      const keys = fromSchema.get(spec.event)!.keys;
      for (const filter of spec.filters!) expect(keys).toContain(filter);
    }
  });
});

describe("describeEvent", () => {
  it.each([
    ["push", null, "on every push"],
    ["push", { branches: ["main"] }, "on pushes to main"],
    ["push", { "branches-ignore": ["gh-pages"] }, "on pushes except to gh-pages"],
    ["push", { tags: ["v*"] }, "on tags like v*"],
    ["push", { branches: ["main"], tags: ["v*"] }, "on pushes to main and on tags like v*"],
    ["push", { branches: ["main"], paths: ["src/**"] }, "on pushes to main that change src/**"],
    ["push", { "paths-ignore": ["docs/**", "*.md"] }, "on pushes unless only docs/**, *.md changed"],
    ["pull_request", null, "on pull requests"],
    [
      "pull_request",
      { branches: ["main"], types: ["opened", "synchronize", "reopened"] },
      "on pull requests into main",
    ],
    ["pull_request", { types: ["closed"] }, "on pull requests (closed)"],
    ["pull_request", { types: ["ready_for_review"] }, "on pull requests (marked ready for review)"],
    ["pull_request_target", { types: ["labeled"] }, "on pull requests, with write access (labeled)"],
    ["schedule", [{ cron: "0 6 * * *" }], "every day at 06:00 UTC"],
    ["schedule", [{ cron: "0 6 * * *" }, { cron: "0 18 * * 5" }], "every day at 06:00 UTC +1 more"],
    ["schedule", [{ cron: "0 9 * * 1", timezone: "Europe/London" }], "every Monday at 09:00 London time"],
    ["workflow_dispatch", null, "with a Run button"],
    ["workflow_dispatch", { inputs: { env: { type: "choice" } } }, "with a Run button (1 input)"],
    ["workflow_call", { inputs: {} }, "when another workflow calls it"],
    ["workflow_run", { workflows: ["CI"], types: ["completed"] }, "after CI completes"],
    ["repository_dispatch", { types: ["deploy"] }, "from an API call (deploy)"],
    ["release", { types: ["published"] }, "when a release is published"],
    ["release", null, "on any release activity"],
    ["issues", { types: ["opened", "labeled"] }, "on issues (opened, labeled)"],
    ["watch", { types: ["started"] }, "when someone stars the repo"],
    ["fork", null, "when the repo is forked"],
    ["merge_group", null, "in the merge queue"],
  ])("%s %j → %s", (event, config, words) => {
    expect(describeEvent(event, config)).toBe(words);
  });
});

describe("reading triggers", () => {
  it("reads on: in any of its forms", () => {
    expect(normalizeOn("push")).toEqual({ push: null });
    expect(normalizeOn(["push", "pull_request"])).toEqual({ push: null, pull_request: null });
    expect(normalizeOn({ release: { types: ["published"] } })).toEqual({ release: { types: ["published"] } });
    expect(normalizeOn(undefined)).toEqual({});
  });

  it("reads filters as only these, or all except these", () => {
    expect(filterOf({ branches: ["main"] }, "branches")).toEqual({ mode: "only", values: ["main"] });
    expect(filterOf({ "paths-ignore": "docs/**" }, "paths")).toEqual({ mode: "except", values: ["docs/**"] });
    expect(filterOf(null, "tags")).toBeNull();
    expect(typesOf({ types: ["opened"] })).toEqual(["opened"]);
    expect(typesOf(null)).toBeNull();
  });
});
