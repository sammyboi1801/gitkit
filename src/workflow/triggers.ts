import type { Filter } from "./events";

// Editing a workflow's `on:` block one event at a time. Each function returns a new config and
// leaves every key it doesn't manage exactly as it was, so nothing written by hand is lost.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
// Workflow data is plain JSON; a JSON copy also works on the webview's reactive proxies, which
// structuredClone refuses.
const clone = (v: unknown): Obj => (isObj(v) ? (JSON.parse(JSON.stringify(v)) as Obj) : {});
/** An empty config is written as `event:` with nothing after it, the way people write it. */
const tidy = (config: Obj): Obj | null => (Object.keys(config).length ? config : null);

/** What a newly added event starts with. */
export function newEventConfig(event: string, branch = "main"): unknown {
  switch (event) {
    case "push":
      return { branches: [branch] };
    case "schedule":
      return [{ cron: "0 6 * * *" }];
    case "workflow_run":
      return { workflows: [], types: ["completed"] };
    case "release":
      return { types: ["published"] };
    case "watch":
      return { types: ["started"] };
    default:
      return null;
  }
}

/** Adds an event (or, for "version tags", a tag filter on push) without touching the others. */
export function addEvent(on: Obj, event: string, branch = "main"): Obj {
  return { ...on, [event]: newEventConfig(event, branch) };
}

/**
 * Adds version tags to push. Pushes with only a tags filter ignore branch pushes, so a push trigger
 * that ran on every branch keeps doing so with branches: ["**"].
 */
export function addVersionTags(on: Obj, pattern = "v*"): Obj {
  const had = "push" in on;
  const push = clone(on.push);
  if (had && push.branches === undefined && push["branches-ignore"] === undefined) push.branches = ["**"];
  delete push["tags-ignore"];
  push.tags = [pattern];
  return { ...on, push };
}

export function removeEvent(on: Obj, event: string): Obj {
  const next = { ...on };
  delete next[event];
  return next;
}

/** A filter as "only these" or "all except these"; no values removes it. */
export function setFilter(config: unknown, filter: Filter, mode: "only" | "except", values: string[]): Obj | null {
  const next = clone(config);
  delete next[filter];
  delete next[`${filter}-ignore`];
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (clean.length) next[mode === "only" ? filter : `${filter}-ignore`] = clean;
  return tidy(next);
}

/** The activity types; null (or GitHub's defaults, when given) removes the key. */
export function setTypes(config: unknown, types: string[] | null, defaults?: string[]): Obj | null {
  const next = clone(config);
  const same = types && defaults && [...types].sort().join() === [...defaults].sort().join();
  if (!types || same) delete next.types;
  else next.types = types;
  return tidy(next);
}

/** Any other key of the event's config: clearing it removes it. */
export function setKey(config: unknown, key: string, value: unknown): Obj | null {
  const next = clone(config);
  const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
  if (empty) delete next[key];
  else next[key] = value;
  return tidy(next);
}

/** Comma- or newline-separated text as a list. */
export const splitList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

// --- Schedules --------------------------------------------------------------------------------

export interface ScheduleRow {
  cron: string;
  timezone?: string;
}

export const scheduleRows = (config: unknown): ScheduleRow[] =>
  Array.isArray(config)
    ? config.filter(isObj).map((s) => ({
        cron: String(s.cron ?? ""),
        ...(typeof s.timezone === "string" ? { timezone: s.timezone } : {}),
      }))
    : [];

/** Rows back into `schedule:`; UTC is GitHub's default, so it isn't written. */
export function withSchedules(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.map((r) =>
    r.timezone && r.timezone !== "UTC" ? { cron: r.cron.trim(), timezone: r.timezone } : { cron: r.cron.trim() },
  );
}

// --- Inputs of the Run button and of reusable workflows ------------------------------------------

export type InputType = "string" | "choice" | "boolean" | "number" | "environment";

export interface InputRow {
  name: string;
  type: InputType;
  description: string;
  required: boolean;
  default: string;
  /** For choice inputs. */
  options: string[];
  /** Keys the row doesn't show, kept as written. */
  rest: Obj;
}

export function inputRows(inputs: unknown): InputRow[] {
  if (!isObj(inputs)) return [];
  return Object.entries(inputs).map(([name, raw]) => {
    const { type, description, required, default: dflt, options, ...rest } = isObj(raw) ? raw : ({} as Obj);
    return {
      name,
      type: (typeof type === "string" ? type : "string") as InputType,
      description: typeof description === "string" ? description : "",
      required: required === true,
      default: dflt === undefined || dflt === null ? "" : String(dflt),
      options: Array.isArray(options) ? options.map(String) : [],
      rest,
    };
  });
}

/** A default as the type GitHub expects: true/false for booleans, a number for numbers. */
function typedDefault(row: InputRow): unknown {
  if (row.default === "") return undefined;
  if (row.type === "boolean") return row.default === "true";
  if (row.type === "number" && /^-?\d+(\.\d+)?$/.test(row.default)) return Number(row.default);
  return row.default;
}

export function withInputs(rows: InputRow[]): Obj | undefined {
  const inputs: Obj = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const input: Obj = { ...row.rest };
    if (row.description.trim()) input.description = row.description.trim();
    if (row.required) input.required = true;
    input.type = row.type;
    const dflt = typedDefault(row);
    if (dflt !== undefined) input.default = dflt;
    if (row.type === "choice") input.options = row.options.map((o) => o.trim()).filter(Boolean);
    inputs[name] = input;
  }
  return Object.keys(inputs).length ? inputs : undefined;
}

export const newInput = (type: InputType = "string"): InputRow => ({
  name: "",
  type,
  description: "",
  required: false,
  default: "",
  options: type === "choice" ? ["staging", "production"] : [],
  rest: {},
});

// --- Secrets and outputs of reusable workflows -----------------------------------------------

export interface SecretRow {
  name: string;
  description: string;
  required: boolean;
}

export const secretRows = (secrets: unknown): SecretRow[] =>
  isObj(secrets)
    ? Object.entries(secrets).map(([name, raw]) => ({
        name,
        description: isObj(raw) && typeof raw.description === "string" ? raw.description : "",
        required: isObj(raw) && raw.required === true,
      }))
    : [];

export function withSecrets(rows: SecretRow[]): Obj | undefined {
  const secrets: Obj = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const secret: Obj = {};
    if (row.description.trim()) secret.description = row.description.trim();
    if (row.required) secret.required = true;
    secrets[row.name.trim()] = Object.keys(secret).length ? secret : null;
  }
  return Object.keys(secrets).length ? secrets : undefined;
}

export interface OutputRow {
  name: string;
  value: string;
  description: string;
}

export const outputRows = (outputs: unknown): OutputRow[] =>
  isObj(outputs)
    ? Object.entries(outputs).map(([name, raw]) => ({
        name,
        value: isObj(raw) && typeof raw.value === "string" ? raw.value : "",
        description: isObj(raw) && typeof raw.description === "string" ? raw.description : "",
      }))
    : [];

export function withOutputs(rows: OutputRow[]): Obj | undefined {
  const outputs: Obj = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const output: Obj = { value: row.value.trim() };
    if (row.description.trim()) output.description = row.description.trim();
    outputs[row.name.trim()] = output;
  }
  return Object.keys(outputs).length ? outputs : undefined;
}
