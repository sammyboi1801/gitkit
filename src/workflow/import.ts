import { parse } from "yaml";
import type { Job, Step, Triggers, WorkflowModel } from "./model";
import { triggersYaml } from "./yaml";

// Turns any GitHub Actions workflow into Studio's model, so hand-written workflows open as
// editable nodes. Jobs become "steps" jobs (their steps kept verbatim) linked by `needs`; whatever
// Studio doesn't model, at job or workflow level, rides along in `extra` and is written back
// unchanged. Triggers that don't fit Studio's chips exactly are kept as written in `rawOn`.

const DEFAULT_CONCURRENCY = { group: "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true };
const READ_ONLY = { contents: "read" };

/** Throws on YAML that doesn't parse; the caller shows the error. */
export function importWorkflow(text: string, file: string): WorkflowModel {
  const data = (parse(text) ?? {}) as Record<string, unknown>;
  if (typeof data !== "object" || Array.isArray(data))
    throw new Error("This file isn't a workflow (no top-level mapping).");
  const on = "on" in data ? data.on : (data as Record<string, unknown>)["true"];

  const model: WorkflowModel = {
    name: typeof data.name === "string" ? data.name : file.replace(/\.ya?ml$/i, ""),
    file,
    triggers: emptyTriggers(),
    jobs: [],
    readOnlyPermissions: false,
    cancelSuperseded: false,
  };
  if (typeof data.name !== "string") model.unnamed = true;

  applyOn(model, on);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "name" || key === "on" || key === "true" || key === "jobs") continue;
    if (key === "permissions" && same(value, READ_ONLY)) model.readOnlyPermissions = true;
    else if (key === "concurrency" && same(value, DEFAULT_CONCURRENCY)) model.cancelSuperseded = true;
    else extra[key] = value;
  }
  if (Object.keys(extra).length) model.extra = extra;

  for (const [id, raw] of Object.entries((data.jobs ?? {}) as Record<string, Record<string, unknown>>)) {
    model.jobs.push(importJob(id, raw ?? {}));
  }
  return model;
}

/**
 * Sets a model's triggers from an `on:` value (from a file, or typed as YAML): as the builder's
 * chips when they say exactly the same, otherwise kept as written.
 */
export function applyOn(model: WorkflowModel, on: unknown): void {
  const mapped = mapTriggers(on);
  model.triggers = mapped ?? emptyTriggers();
  delete model.rawOn;
  if (!mapped || !same(triggersYaml(model), normalizeOn(on))) model.rawOn = on;
}

function importJob(id: string, raw: Record<string, unknown>): Job {
  const { name, "runs-on": runsOn, needs, steps, ...rest } = raw;
  const job: Job = {
    id,
    name: typeof name === "string" ? name : id,
    template: "steps",
    runsOn: typeof runsOn === "string" ? runsOn : "ubuntu-latest",
    versions: [],
    needs: needs === undefined ? [] : (Array.isArray(needs) ? needs : [needs]).map(String),
    inputs: {},
    steps: Array.isArray(steps) ? (steps as Step[]) : [],
  };
  // Runner groups, label arrays and expressions are kept exactly as written.
  if (runsOn !== undefined && typeof runsOn !== "string") rest["runs-on"] = runsOn;
  if (Object.keys(rest).length) job.extra = rest;
  return job;
}

function emptyTriggers(): Triggers {
  return {
    push: { enabled: false, branches: [] },
    pullRequest: { enabled: false, branches: [] },
    tags: { enabled: false, pattern: "v*" },
    schedule: { enabled: false, cron: "0 6 * * *" },
    manual: false,
  };
}

/** `on: push` and `on: [push, pull_request]` mean the same as the mapping form with nulls. */
function normalizeOn(on: unknown): unknown {
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [String(e), null]));
  return on;
}

/** Studio's triggers for `on`, or null when it uses something the chips can't show. */
function mapTriggers(on: unknown): Triggers | null {
  const events = normalizeOn(on);
  if (!events || typeof events !== "object") return null;
  const t = emptyTriggers();
  for (const [event, config] of Object.entries(events as Record<string, unknown>)) {
    const c = (config ?? {}) as Record<string, unknown>;
    const strings = (v: unknown) =>
      Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
    switch (event) {
      case "push": {
        const branches = c.branches === undefined ? [] : strings(c.branches);
        const tags = c.tags === undefined ? [] : strings(c.tags);
        if (!branches || !tags || tags.length > 1) return null;
        t.push = { enabled: c.tags === undefined || c.branches !== undefined, branches };
        if (tags.length) t.tags = { enabled: true, pattern: tags[0] };
        break;
      }
      case "pull_request": {
        const branches = c.branches === undefined ? [] : strings(c.branches);
        if (!branches) return null;
        t.pullRequest = { enabled: true, branches };
        break;
      }
      case "schedule": {
        const crons = Array.isArray(config) ? config : [];
        if (crons.length !== 1 || typeof crons[0]?.cron !== "string") return null;
        t.schedule = { enabled: true, cron: crons[0].cron };
        break;
      }
      case "workflow_dispatch":
        t.manual = true;
        break;
      default:
        return null;
    }
  }
  return t;
}

/** Structural equality that ignores key order. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
