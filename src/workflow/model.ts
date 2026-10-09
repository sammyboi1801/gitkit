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
  | "docker-publish"
  | "github-release"
  | "pages-deploy"
  | "custom";

export type Stack = "node" | "python" | "docker" | "go" | "rust";

export interface TemplateInput {
  key: string;
  label: string;
  placeholder: string;
  default: string;
  /** Leaving it empty skips that step instead of being an error. */
  optional?: boolean;
}

export interface Template {
  id: TemplateId;
  label: string;
  stack: Stack | null;
  /** Where it sits in the "add a job" menu. */
  group: "check" | "build" | "ship" | "other";
  description: string;
  /** What the matrix varies, if anything, e.g. "node-version". */
  matrixKey?: string;
  /** Versions offered as toggles in the editor. */
  versionChoices?: string[];
  defaultVersions: string[];
  defaultId: string;
  /** Inputs shown when editing the job. */
  inputs: TemplateInput[];
  /** Extra token permissions this job needs, granted to this job only. */
  permissions?: Record<string, "read" | "write">;
}

export const TEMPLATES: Template[] = [
  {
    id: "node-lint",
    label: "Lint (Node)",
    stack: "node",
    group: "check",
    description: "Install dependencies and run the lint script.",
    defaultVersions: [],
    defaultId: "lint",
    inputs: [{ key: "command", label: "Command", placeholder: "npm run lint", default: "npm run lint" }],
  },
  {
    id: "node-test",
    label: "Test (Node)",
    stack: "node",
    group: "check",
    versionChoices: ["20", "22", "24"],
    description: "Run tests on each Node version.",
    matrixKey: "node-version",
    defaultVersions: ["22", "24"],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "npm test", default: "npm test" }],
  },
  {
    id: "node-build",
    label: "Build (Node)",
    stack: "node",
    group: "build",
    description: "Build the project to catch compile errors.",
    defaultVersions: [],
    defaultId: "build",
    inputs: [{ key: "command", label: "Command", placeholder: "npm run build", default: "npm run build" }],
  },
  {
    id: "python-lint",
    label: "Lint (Python)",
    stack: "python",
    group: "check",
    description: "Check style and common bugs with Ruff.",
    defaultVersions: [],
    defaultId: "lint",
    inputs: [{ key: "command", label: "Command", placeholder: "ruff check .", default: "ruff check ." }],
  },
  {
    id: "python-test",
    label: "Test (Python)",
    stack: "python",
    group: "check",
    versionChoices: ["3.9", "3.10", "3.11", "3.12", "3.13"],
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
    group: "build",
    description: "Build the Dockerfile to make sure the image still builds.",
    defaultVersions: [],
    defaultId: "docker",
    inputs: [{ key: "context", label: "Context", placeholder: ".", default: "." }],
  },
  {
    id: "go-test",
    label: "Test (Go)",
    stack: "go",
    group: "check",
    versionChoices: ["1.21", "1.22", "1.23", "1.24"],
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
    group: "check",
    description: "Run cargo test.",
    defaultVersions: [],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "cargo test", default: "cargo test" }],
  },
  {
    id: "docker-publish",
    label: "Publish Docker image",
    stack: "docker",
    group: "ship",
    description: "Build the Dockerfile and push the image to GitHub Container Registry (ghcr.io).",
    defaultVersions: [],
    defaultId: "publish-image",
    inputs: [{ key: "context", label: "Folder with the Dockerfile", placeholder: ".", default: "." }],
    permissions: { packages: "write" },
  },
  {
    id: "github-release",
    label: "GitHub release",
    stack: null,
    group: "ship",
    description: "Create a GitHub release for the tag that triggered the run, with notes generated from the commits.",
    defaultVersions: [],
    defaultId: "release",
    inputs: [],
    permissions: { contents: "write" },
  },
  {
    id: "pages-deploy",
    label: "Deploy to GitHub Pages",
    stack: null,
    group: "ship",
    description: "Publish a folder as your GitHub Pages site, optionally building it first.",
    defaultVersions: [],
    defaultId: "deploy-pages",
    inputs: [
      { key: "build", label: "Build command", placeholder: "npm ci && npm run build", default: "", optional: true },
      { key: "folder", label: "Folder to publish", placeholder: "dist", default: "." },
    ],
    permissions: { pages: "write", "id-token": "write" },
  },
  {
    id: "custom",
    label: "Custom command",
    stack: null,
    group: "other",
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
    if (template(job.template).inputs.some((i) => !i.optional && !job.inputs[i.key]?.trim())) {
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

// --- Goals: the start screen's "what do you want to automate?" -----------------------------

export interface Goal {
  id: "check" | "pr" | "docker" | "release" | "pages" | "schedule" | "blank";
  title: string;
  description: string;
  icon: string;
  /** Suggested for this project, e.g. Docker when there's a Dockerfile. */
  recommended: boolean;
  model: WorkflowModel;
}

const triggers = (overrides: Partial<Triggers> = {}): Triggers => ({
  push: { enabled: false, branches: [] },
  pullRequest: { enabled: false, branches: [] },
  tags: { enabled: false, pattern: "v*" },
  schedule: { enabled: false, cron: "0 6 * * *" },
  manual: true,
  ...overrides,
});

const workflow = (name: string, file: string, t: Triggers, jobs: Job[], cancelSuperseded = true): WorkflowModel => ({
  name,
  file,
  triggers: t,
  jobs,
  readOnlyPermissions: true,
  cancelSuperseded,
});

const single = (id: TemplateId, inputs: Record<string, string> = {}): Job[] => {
  const job = newJob(id, []);
  Object.assign(job.inputs, inputs);
  return [job];
};

export function goals(facts: ProjectFacts): Goal[] {
  const stacks = detectStacks(facts);
  const checks = suggestWorkflow(facts);
  const branch = facts.defaultBranch ?? "main";
  const buildsSite = !!facts.npmScripts?.build;
  return [
    {
      id: "check",
      title: "Check every push",
      description: "Lint and test your code whenever you push, and on pull requests.",
      icon: "pass",
      recommended: stacks.length > 0,
      model: checks,
    },
    {
      id: "pr",
      title: "Test pull requests",
      description: "Run the same checks only on pull requests, before anything is merged.",
      icon: "git-pull-request",
      recommended: false,
      model: workflow(
        "Pull request checks",
        "pr.yml",
        triggers({ pullRequest: { enabled: true, branches: [branch] } }),
        checks.jobs,
      ),
    },
    {
      id: "docker",
      title: "Publish a Docker image",
      description: "Build your Dockerfile and push it to the GitHub container registry when you tag a version.",
      icon: "package",
      recommended: stacks.includes("docker"),
      model: workflow(
        "Docker image",
        "docker.yml",
        triggers({ tags: { enabled: true, pattern: "v*" } }),
        single("docker-publish"),
      ),
    },
    {
      id: "release",
      title: "Release when I tag a version",
      description: "Push a tag like v1.2.0 and get a GitHub release with notes written from your commits.",
      icon: "tag",
      recommended: false,
      model: workflow(
        "Release",
        "release.yml",
        triggers({ tags: { enabled: true, pattern: "v*" } }),
        single("github-release"),
      ),
    },
    {
      id: "pages",
      title: "Deploy a site to GitHub Pages",
      description: "Publish your site every time you push to the main branch.",
      icon: "globe",
      recommended: false,
      model: workflow(
        "Deploy site",
        "pages.yml",
        triggers({ push: { enabled: true, branches: [branch] } }),
        single("pages-deploy", buildsSite ? { build: "npm ci && npm run build", folder: "dist" } : {}),
        // A half-cancelled deploy is worse than a slightly late one.
        false,
      ),
    },
    {
      id: "schedule",
      title: "Run something on a schedule",
      description: "Run a script every day, week or hour: reports, cleanups, link checks.",
      icon: "watch",
      recommended: false,
      model: workflow(
        "Scheduled job",
        "scheduled.yml",
        triggers({ schedule: { enabled: true, cron: "0 6 * * *" } }),
        single("custom", { command: "./scripts/nightly.sh" }),
      ),
    },
    {
      id: "blank",
      title: "Start from scratch",
      description: "An empty workflow that runs on pushes to the main branch. Add the jobs you want.",
      icon: "new-file",
      recommended: false,
      model: workflow("Workflow", "workflow.yml", triggers({ push: { enabled: true, branches: [branch] } }), []),
    },
  ];
}

// --- Plain English for the builder ----------------------------------------------------------

export const SCHEDULES = [
  { cron: "0 * * * *", label: "every hour" },
  { cron: "0 6 * * *", label: "every day at 06:00 UTC" },
  { cron: "0 2 * * *", label: "every night at 02:00 UTC" },
  { cron: "0 6 * * 1", label: "every Monday at 06:00 UTC" },
  { cron: "0 6 1 * *", label: "on the 1st of every month" },
];

export function describeSchedule(cron: string): string {
  return SCHEDULES.find((s) => s.cron === cron.trim())?.label ?? `on schedule "${cron.trim()}"`;
}

/** The triggers as sentence parts: "on pushes to main", "on pull requests", and so on. */
export function describeTriggers(t: Triggers): string[] {
  const list = (names: string[]) =>
    names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
  const parts: string[] = [];
  if (t.push.enabled) parts.push(t.push.branches.length ? `on pushes to ${list(t.push.branches)}` : "on every push");
  if (t.pullRequest.enabled) {
    parts.push(
      t.pullRequest.branches.length ? `on pull requests into ${list(t.pullRequest.branches)}` : "on pull requests",
    );
  }
  if (t.tags.enabled) parts.push(`when you push a tag like ${t.tags.pattern}`);
  if (t.schedule.enabled) parts.push(describeSchedule(t.schedule.cron));
  if (t.manual) parts.push("when you click Run on GitHub");
  return parts;
}

export const RUNNERS: { value: Runner; label: string }[] = [
  { value: "ubuntu-latest", label: "Linux" },
  { value: "windows-latest", label: "Windows" },
  { value: "macos-latest", label: "macOS" },
];
