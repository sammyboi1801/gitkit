import { parse, stringify } from "yaml";

// Pure helpers behind the builder's "More options": reading and writing nested workflow keys
// (env, strategy.matrix, defaults.run...) so that clearing a field removes it from the YAML instead
// of leaving empty leftovers, plus the YAML escape hatch for everything else.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** A value counts as empty when the YAML would be better off without it. */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isObj(value)) return Object.keys(value).length === 0;
  return false;
}

export function getPath(target: Obj | undefined, path: readonly string[]): unknown {
  let current: unknown = target;
  for (const key of path) {
    if (!isObj(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Sets `path` in `target` (creating objects on the way), or removes it when `value` is empty, then
 * removes any objects left empty by that. Returns `target`, or undefined if it ended up empty.
 */
export function setPath(target: Obj | undefined, path: readonly string[], value: unknown): Obj | undefined {
  const root: Obj = target ?? {};
  const [key, ...rest] = path;
  if (rest.length === 0) {
    if (isEmpty(value)) delete root[key];
    else root[key] = value;
  } else {
    const child = setPath(isObj(root[key]) ? (root[key] as Obj) : undefined, rest, value);
    if (child === undefined) delete root[key];
    else root[key] = child;
  }
  return Object.keys(root).length ? root : undefined;
}

/** Text from a field as the value to store: numbers and true/false as such, the rest as strings. */
export function scalar(text: string): string | number | boolean {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  // Only plain integers: "3.10" must stay a string (a Python version, not 3.1).
  if (/^-?\d+$/.test(t) && !/^-?0\d/.test(t)) return Number(t);
  return text;
}

// --- Matrix -----------------------------------------------------------------------------------

/** strategy.matrix as rows people can edit: a variable and its comma-separated values. */
export function matrixRows(strategy: unknown): { name: string; values: string }[] {
  const matrix = getPath(isObj(strategy) ? strategy : undefined, ["matrix"]);
  if (!isObj(matrix)) return [];
  return Object.entries(matrix)
    .filter(([, v]) => Array.isArray(v) && v.every((x) => typeof x !== "object"))
    .map(([name, v]) => ({ name, values: (v as unknown[]).join(", ") }));
}

/**
 * Writes the rows back into strategy.matrix, keeping anything the rows can't show (include,
 * exclude, object values, fail-fast). Returns the new strategy, or undefined if nothing is left.
 */
export function withMatrix(strategy: unknown, rows: readonly { name: string; values: string }[]): Obj | undefined {
  // A JSON copy: strategy may be one of the webview's reactive proxies, which structuredClone refuses.
  const next: Obj = isObj(strategy) ? (JSON.parse(JSON.stringify(strategy)) as Obj) : {};
  const old = isObj(next.matrix) ? next.matrix : {};
  const kept = Object.fromEntries(
    Object.entries(old).filter(([, v]) => !(Array.isArray(v) && v.every((x) => typeof x !== "object"))),
  );
  const fromRows = Object.fromEntries(
    rows
      .filter((r) => r.name.trim())
      .map((r) => [
        r.name.trim(),
        r.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => (/^-?\d+$/.test(v) && !/^-?0\d/.test(v) ? Number(v) : v)),
      ])
      .filter(([, values]) => (values as unknown[]).length),
  );
  return setPath(next, ["matrix"], { ...kept, ...fromRows });
}

/** A matrix combination as text people can type: "os=windows-latest, node=20". */
export function comboText(combo: unknown): string {
  if (!isObj(combo)) return "";
  return Object.entries(combo)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/** "os=windows-latest, node=20" → { os: "windows-latest", node: 20 }; null when it isn't key=value pairs. */
export function parseCombo(text: string): Obj | null {
  const combo: Obj = {};
  for (const part of text.split(",")) {
    if (!part.trim()) continue;
    const at = part.indexOf("=");
    if (at <= 0) return null;
    combo[part.slice(0, at).trim()] = scalar(part.slice(at + 1).trim());
  }
  return Object.keys(combo).length ? combo : null;
}

/**
 * strategy.matrix.include or .exclude from rows of combinations. Rows that aren't key=value pairs
 * yet (still being typed) are left out until they are.
 */
export function withCombos(strategy: unknown, key: "include" | "exclude", rows: readonly string[]): Obj | undefined {
  const next: Obj = isObj(strategy) ? (JSON.parse(JSON.stringify(strategy)) as Obj) : {};
  const combos = rows.map(parseCombo).filter((c): c is Obj => c !== null);
  return setPath(next, ["matrix", key], combos);
}

/** The environment's name and URL, however it's written: a string, or { name, url }. */
export function environmentOf(env: unknown): { name: string; url: string } {
  if (typeof env === "string") return { name: env, url: "" };
  if (isObj(env))
    return { name: typeof env.name === "string" ? env.name : "", url: typeof env.url === "string" ? env.url : "" };
  return { name: "", url: "" };
}

/** Back to the shortest form: just the name, unless there's a URL (or other keys) too. */
export function withEnvironment(env: unknown, name: string, url: string): unknown {
  const rest = isObj(env) ? Object.fromEntries(Object.entries(env).filter(([k]) => k !== "name" && k !== "url")) : {};
  if (!name.trim() && !url.trim() && !Object.keys(rest).length) return undefined;
  if (!url.trim() && !Object.keys(rest).length) return name.trim();
  return { name: name.trim(), ...(url.trim() ? { url: url.trim() } : {}), ...rest };
}

// --- Services ---------------------------------------------------------------------------------

export interface ServiceRow {
  name: string;
  image: string;
  /** Comma-separated, like "5432:5432". */
  ports: string;
}

/** services as rows: a name, a container image and its ports. Other service keys are kept. */
export function serviceRows(services: unknown): ServiceRow[] {
  if (!isObj(services)) return [];
  return Object.entries(services).map(([name, s]) => ({
    name,
    image: isObj(s) && typeof s.image === "string" ? s.image : typeof s === "string" ? s : "",
    ports: isObj(s) && Array.isArray(s.ports) ? s.ports.join(", ") : "",
  }));
}

export function withServices(services: unknown, rows: readonly ServiceRow[]): Obj | undefined {
  const old = isObj(services) ? services : {};
  const next: Obj = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const previous = isObj(old[name]) ? (old[name] as Obj) : {};
    const ports = row.ports
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    let service = setPath({ ...previous }, ["image"], row.image.trim());
    service = setPath(service, ["ports"], ports);
    next[name] = service ?? {};
  }
  return Object.keys(next).length ? next : undefined;
}

// --- Permissions ------------------------------------------------------------------------------

/** The token scopes a workflow can ask for, with what each is for. */
export const PERMISSION_SCOPES: { scope: string; what: string }[] = [
  { scope: "contents", what: "the code, releases and pushing" },
  { scope: "pull-requests", what: "comments, labels and reviews on PRs" },
  { scope: "issues", what: "comments and labels on issues" },
  { scope: "packages", what: "publishing to GitHub Packages (ghcr.io)" },
  { scope: "pages", what: "deploying GitHub Pages" },
  { scope: "id-token", what: "signing in to clouds and registries without secrets (OIDC)" },
  { scope: "actions", what: "workflow runs and caches" },
  { scope: "checks", what: "check runs" },
  { scope: "statuses", what: "commit statuses" },
  { scope: "deployments", what: "deployments" },
  { scope: "security-events", what: "code scanning alerts" },
  { scope: "attestations", what: "build provenance attestations" },
];

/** Which levels a scope can have: id-token can't be read, only granted or not. */
export const levelsFor = (scope: string): string[] =>
  scope === "id-token" ? ["none", "write"] : ["none", "read", "write"];

// --- YAML escape hatch ------------------------------------------------------------------------

/** A value as YAML for the "Edit as YAML" box; empty for nothing. */
export function toYamlText(value: unknown): string {
  return isEmpty(value) ? "" : stringify(value, { lineWidth: 0 });
}

/**
 * Text from an "Edit as YAML" box: a mapping (or nothing, when cleared), or the reason it can't be
 * used. Lists and plain values are refused, since these boxes stand for a set of keys.
 */
export function parseYamlMapping(text: string): { value: Obj | undefined } | { error: string } {
  if (!text.trim()) return { value: undefined };
  try {
    const value: unknown = parse(text);
    if (value === null || value === undefined) return { value: undefined };
    if (!isObj(value)) return { error: "Write keys and values, like  name: value" };
    return { value };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { error: message };
  }
}
