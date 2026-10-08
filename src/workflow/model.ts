// The Workflow Studio model: a small, visual-friendly description of a GitHub Actions workflow.
// Pure, so the webview previews exactly what the extension will save.

export type Runner = "ubuntu-latest" | "windows-latest" | "macos-latest";

export interface Triggers {
  push: { enabled: boolean; branches: string[] };
  pullRequest: { enabled: boolean; branches: string[] };
  tags: { enabled: boolean; pattern: string };
  schedule: { enabled: boolean; cron: string };
  manual: boolean;
}

export interface Job {
  /** The YAML key, e.g. "test". */
  id: string;
  name: string;
  template: TemplateId;
  runsOn: Runner;
  /** Versions for the template's matrix, e.g. ["20", "22"]; empty means no matrix. */
  versions: string[];
  /** Ids of jobs that must finish first. */
  needs: string[];
  /** Free-form inputs a template asks for, e.g. the command for "custom". */
  inputs: Record<string, string>;
}

export interface WorkflowModel {
  name: string;
  /** File name inside .github/workflows, e.g. "ci.yml". */
  file: string;
  triggers: Triggers;
  jobs: Job[];
  /** Only read repo contents by default: least privilege. */
  readOnlyPermissions: boolean;
  /** Cancel an older run of the same branch when a new one starts. */
  cancelSuperseded: boolean;
}

export type TemplateId =
  | "node-lint"
  | "node-test"
  | "node-build"
  | "python-lint"
  | "python-test"
  | "docker-build"
  | "go-test"
  | "rust-test"
  | "custom";

export type Stack = "node" | "python" | "docker" | "go" | "rust";

export interface Template {
  id: TemplateId;
  label: string;
  stack: Stack | null;
  description: string;
  /** What the matrix varies, if anything, e.g. "node-version". */
  matrixKey?: string;
  defaultVersions: string[];
  defaultId: string;
  /** Inputs shown on the job card. */
  inputs: { key: string; label: string; placeholder: string; default: string }[];
}

export const TEMPLATES: Template[] = [
  {
    id: "node-lint",
    label: "Lint (Node)",
    stack: "node",
    description: "Install dependencies and run the lint script.",
    defaultVersions: [],
    defaultId: "lint",
    inputs: [{ key: "command", label: "Command", placeholder: "npm run lint", default: "npm run lint" }],
  },
  {
    id: "node-test",
    label: "Test (Node)",
    stack: "node",
    description: "Run tests on each Node version.",
    matrixKey: "node-version",
    defaultVersions: ["20", "22"],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "npm test", default: "npm test" }],
  },
  {
    id: "node-build",
    label: "Build (Node)",
    stack: "node",
    description: "Build the project to catch compile errors.",
    defaultVersions: [],
    defaultId: "build",
    inputs: [{ key: "command", label: "Command", placeholder: "npm run build", default: "npm run build" }],
  },
  {
    id: "python-lint",
    label: "Lint (Python)",
    stack: "python",
    description: "Check style and common bugs with Ruff.",
    defaultVersions: [],
    defaultId: "lint",
    inputs: [{ key: "command", label: "Command", placeholder: "ruff check .", default: "ruff check ." }],
  },
  {
    id: "python-test",
    label: "Test (Python)",
    stack: "python",
    description: "Run pytest on each Python version.",
    matrixKey: "python-version",
    defaultVersions: ["3.11", "3.12"],
    defaultId: "test",
    inputs: [
      {
        key: "install",
        label: "Install",
        placeholder: "pip install -r requirements.txt",
        default: "pip install -r requirements.txt",
      },
      { key: "command", label: "Command", placeholder: "pytest", default: "pytest" },
    ],
  },
  {
    id: "docker-build",
    label: "Docker image",
    stack: "docker",
    description: "Build the Dockerfile to make sure the image still builds.",
    defaultVersions: [],
    defaultId: "docker",
    inputs: [{ key: "context", label: "Context", placeholder: ".", default: "." }],
  },
  {
    id: "go-test",
    label: "Test (Go)",
    stack: "go",
    description: "Run go test on each Go version.",
    matrixKey: "go-version",
    defaultVersions: ["1.22", "1.23"],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "go test ./...", default: "go test ./..." }],
  },
  {
    id: "rust-test",
    label: "Test (Rust)",
    stack: "rust",
    description: "Run cargo test.",
    defaultVersions: [],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "cargo test", default: "cargo test" }],
  },
  {
    id: "custom",
    label: "Custom command",
    stack: null,
    description: "Run any shell command after checkout.",
    defaultVersions: [],
    defaultId: "custom",
    inputs: [{ key: "command", label: "Command", placeholder: "./scripts/check.sh", default: "echo hello" }],
  },
];

export const template = (id: TemplateId): Template => TEMPLATES.find((t) => t.id === id)!;

export function newJob(id: TemplateId, existing: readonly Job[]): Job {
  const t = template(id);
  let jobId = t.defaultId;
  for (let n = 2; existing.some((j) => j.id === jobId); n++) jobId = `${t.defaultId}-${n}`;
  return {
    id: jobId,
    name: t.label.replace(/ \(.*\)$/, ""),
    template: id,
    runsOn: "ubuntu-latest",
    versions: [...t.defaultVersions],
    needs: [],
    inputs: Object.fromEntries(t.inputs.map((i) => [i.key, i.default])),
  };
}

// --- Stack detection ------------------------------------------------------------------------

export interface ProjectFacts {
  files: string[];
  /** package.json "scripts", if there is one. */
  npmScripts?: Record<string, string>;
  /** The branch pushes should trigger on, usually main. */
  defaultBranch?: string;
}

export function detectStacks(facts: ProjectFacts): Stack[] {
  const has = (name: string) => facts.files.includes(name);
  const stacks: Stack[] = [];
  if (has("package.json")) stacks.push("node");
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) stacks.push("python");
  if (has("go.mod")) stacks.push("go");
  if (has("Cargo.toml")) stacks.push("rust");
  if (has("Dockerfile")) stacks.push("docker");
  return stacks;
}

/** A sensible first workflow for what's in the repo: lint, then test and build in parallel. */
export function suggestWorkflow(facts: ProjectFacts): WorkflowModel {
  const stacks = detectStacks(facts);
  const branch = facts.defaultBranch ?? "main";
  const jobs: Job[] = [];
  const add = (id: TemplateId, inputs: Record<string, string> = {}) => {
    const job = newJob(id, jobs);
    Object.assign(job.inputs, inputs);
    jobs.push(job);
    return job;
  };

  if (stacks.includes("node")) {
    const scripts = facts.npmScripts ?? {};
    const lint = scripts.lint ? add("node-lint") : undefined;
    const after = lint ? [lint.id] : [];
    if (scripts.test && !/no test specified/.test(scripts.test)) add("node-test").needs = after;
    if (scripts.build) add("node-build").needs = after;
  }
  if (stacks.includes("python")) {
    const lint = add("python-lint");
    const install = facts.files.includes("requirements.txt")
      ? "pip install -r requirements.txt"
      : 'pip install -e ".[dev]"';
    add("python-test", { install }).needs = [lint.id];
  }
  if (stacks.includes("go")) add("go-test");
  if (stacks.includes("rust")) add("rust-test");
  if (stacks.includes("docker")) add("docker-build");
  if (jobs.length === 0) add("custom");

  return {
    name: "CI",
    file: "ci.yml",
    triggers: {
      push: { enabled: true, branches: [branch] },
      pullRequest: { enabled: true, branches: [] },
      tags: { enabled: false, pattern: "v*" },
      schedule: { enabled: false, cron: "0 6 * * 1" },
      manual: true,
    },
    jobs,
    readOnlyPermissions: true,
    cancelSuperseded: true,
  };
}

// --- Validation -----------------------------------------------------------------------------

export interface Problem {
  /** The job it's about, if any. */
  job?: string;
  message: string;
}

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;

export function validate(model: WorkflowModel): Problem[] {
  const problems: Problem[] = [];
  const t = model.triggers;

  if (!model.name.trim()) problems.push({ message: "Give the workflow a name." });
  if (!FILE.test(model.file))
    problems.push({ message: "The file name must end in .yml and use only letters, numbers, dots, dashes." });
  if (!t.push.enabled && !t.pullRequest.enabled && !t.tags.enabled && !t.schedule.enabled && !t.manual) {
    problems.push({ message: "Pick at least one trigger, or the workflow never runs." });
  }
  if (t.schedule.enabled && t.schedule.cron.trim().split(/\s+/).length !== 5) {
    problems.push({ message: "A schedule needs 5 cron fields: minute hour day month weekday." });
  }
  if (t.tags.enabled && !t.tags.pattern.trim()) problems.push({ message: "Give a tag pattern, like v*." });
  if (model.jobs.length === 0) problems.push({ message: "Add at least one job." });

  const ids = new Set<string>();
  for (const job of model.jobs) {
    if (!JOB_ID.test(job.id))
      problems.push({
        job: job.id,
        message: `"${job.id}" can only use letters, numbers, - and _, and can't start with a number.`,
      });
    if (ids.has(job.id)) problems.push({ job: job.id, message: `Two jobs are called "${job.id}".` });
    ids.add(job.id);
    for (const need of job.needs) {
      if (!model.jobs.some((j) => j.id === need))
        problems.push({ job: job.id, message: `Runs after "${need}", which doesn't exist.` });
    }
    if (template(job.template).inputs.some((i) => !job.inputs[i.key]?.trim())) {
      problems.push({ job: job.id, message: `${job.name}: fill in every field.` });
    }
  }

  const cycle = findCycle(model.jobs);
  if (cycle) problems.push({ message: `These jobs wait on each other forever: ${cycle.join(" → ")}.` });
  return problems;
}

function findCycle(jobs: readonly Job[]): string[] | null {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const need of byId.get(id)?.needs ?? []) {
      const found = byId.has(need) ? visit(need) : null;
      if (found) return found;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };
  for (const job of jobs) {
    const found = visit(job.id);
    if (found) return found;
  }
  return null;
}

/** Jobs grouped into stages: everything in a stage can run in parallel once earlier stages finish. */
export function stages(jobs: readonly { id: string; needs: string[] }[]): string[][] {
  const level = new Map<string, number>();
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const depth = (id: string, seen: Set<string>): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0; // A cycle; validation reports it.
    seen.add(id);
    const needs = (byId.get(id)?.needs ?? []).filter((n) => byId.has(n));
    const d = needs.length ? 1 + Math.max(...needs.map((n) => depth(n, seen))) : 0;
    level.set(id, d);
    return d;
  };
  jobs.forEach((j) => depth(j.id, new Set()));
  const result: string[][] = [];
  for (const job of jobs) (result[level.get(job.id)!] ??= []).push(job.id);
  return result.filter(Boolean);
}
