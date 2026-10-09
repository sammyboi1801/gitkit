// The Workflow Studio model: a small, visual-friendly description of a GitHub Actions workflow.
// Pure, so the webview previews exactly what the extension will save.

/** A runner label: GitHub's own (ubuntu-latest…) or any other, like self-hosted. */
export type Runner = string;

/**
 * One step of a job, exactly as it appears in YAML. Studio edits name/run/uses/with/if and keeps
 * any other keys (env, shell, working-directory…) untouched.
 */
export interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string | number | boolean>;
  if?: string;
  [key: string]: unknown;
}

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
  /** For "steps" jobs: the steps, in order. Other templates generate theirs. */
  steps?: Step[];
  /** Job settings Studio doesn't model (services, container, environment, timeout…), kept as written. */
  extra?: Record<string, unknown>;
}

export interface WorkflowModel {
  name: string;
  /** File name inside .github/workflows, e.g. "ci.yml". */
  file: string;
  triggers: Triggers;
  /** Triggers Studio can't represent exactly (paths filters, other events…), kept as written. */
  rawOn?: unknown;
  jobs: Job[];
  /** Only read repo contents by default: least privilege. */
  readOnlyPermissions: boolean;
  /** Cancel an older run of the same branch when a new one starts. */
  cancelSuperseded: boolean;
  /** Top-level settings Studio doesn't model (env, defaults, run-name, custom permissions…). */
  extra?: Record<string, unknown>;
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
  | "custom"
  | "steps";

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
  /** Codicon shown on cards and in the picker. */
  icon: string;
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
    icon: "checklist",
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
    icon: "beaker",
    group: "check",
    versionChoices: ["22", "24", "26"],
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
    icon: "tools",
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
    icon: "checklist",
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
    icon: "beaker",
    group: "check",
    versionChoices: ["3.11", "3.12", "3.13", "3.14"],
    description: "Run pytest on each Python version.",
    matrixKey: "python-version",
    defaultVersions: ["3.13", "3.14"],
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
    icon: "package",
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
    icon: "beaker",
    group: "check",
    versionChoices: ["1.25", "1.26", "1.27"],
    description: "Run go test on each Go version.",
    matrixKey: "go-version",
    defaultVersions: ["1.26", "1.27"],
    defaultId: "test",
    inputs: [{ key: "command", label: "Command", placeholder: "go test ./...", default: "go test ./..." }],
  },
  {
    id: "rust-test",
    label: "Test (Rust)",
    stack: "rust",
    icon: "beaker",
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
    icon: "cloud-upload",
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
    icon: "tag",
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
    icon: "globe",
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
    icon: "terminal",
    group: "other",
    description: "Run any shell command after checkout.",
    defaultVersions: [],
    defaultId: "custom",
    inputs: [{ key: "command", label: "Command", placeholder: "./scripts/check.sh", default: "echo hello" }],
  },
  {
    id: "steps",
    label: "Your own steps",
    stack: null,
    icon: "list-ordered",
    group: "other",
    description: "Build a job step by step: run commands, use any action from the Marketplace.",
    defaultVersions: [],
    defaultId: "job",
    inputs: [],
  },
];

export const template = (id: TemplateId): Template => TEMPLATES.find((t) => t.id === id)!;

// What a job looks like on its card when it has no template (imported, or its own steps): read
// from its name first, then from what its steps run. First match wins.
const LOOKS: [RegExp, string, Template["group"]][] = [
  [/\b(lint|eslint|ruff|prettier|fmt|format|style)\b/, "checklist", "check"],
  [/\b(test|tests|pytest|vitest|jest|mocha|spec|e2e)\b/, "beaker", "check"],
  [/\b(docker|image|container|ghcr|build-push)\b/, "package", "ship"],
  [/\b(deploy|pages|deploy-pages)\b/, "globe", "ship"],
  [/\b(release|publish|npm publish|pypi|upload to)\b/, "rocket", "ship"],
  [/\b(build|compile|bundle|tsc|vite build|make)\b/, "tools", "build"],
];

/** The icon and colour group for a job's card. */
export function jobLook(job: Job): { icon: string; group: Template["group"] } {
  if (job.template !== "steps") {
    const t = template(job.template);
    return { icon: t.icon, group: t.group };
  }
  const name = `${job.id} ${job.name}`.toLowerCase().replace(/[-_]/g, " ");
  const steps = (job.steps ?? [])
    .map((s) => `${s.name ?? ""} ${s.run ?? ""} ${s.uses ?? ""}`)
    .join(" ")
    .toLowerCase();
  for (const text of [name, steps]) {
    const found = LOOKS.find(([pattern]) => pattern.test(text));
    if (found) return { icon: found[1], group: found[2] };
  }
  return { icon: "list-ordered", group: "other" };
}

export function newJob(id: TemplateId, existing: readonly Job[]): Job {
  const t = template(id);
  let jobId = t.defaultId;
  for (let n = 2; existing.some((j) => j.id === jobId); n++) jobId = `${t.defaultId}-${n}`;
  const job: Job = {
    id: jobId,
    name: id === "steps" ? "New job" : t.label.replace(/ \(.*\)$/, ""),
    template: id,
    runsOn: "ubuntu-latest",
    versions: [...t.defaultVersions],
    needs: [],
    inputs: Object.fromEntries(t.inputs.map((i) => [i.key, i.default])),
  };
  if (id === "steps") job.steps = [{ uses: ACTIONS.checkout }, { name: "Run a command", run: "echo hello" }];
  return job;
}

// --- Steps ----------------------------------------------------------------------------------

// Current major versions as of October 2026 (checked against each action's latest release).
export const ACTIONS = {
  checkout: "actions/checkout@v7",
  node: "actions/setup-node@v7",
  python: "actions/setup-python@v7",
  go: "actions/setup-go@v7",
  java: "actions/setup-java@v6",
  dotnet: "actions/setup-dotnet@v6",
  ruby: "ruby/setup-ruby@v1",
  bun: "oven-sh/setup-bun@v2",
  pnpm: "pnpm/action-setup@v6",
  cache: "actions/cache@v6",
  upload: "actions/upload-artifact@v7",
  download: "actions/download-artifact@v8",
  buildx: "docker/setup-buildx-action@v4",
  dockerBuild: "docker/build-push-action@v7",
  dockerLogin: "docker/login-action@v4",
  dockerMeta: "docker/metadata-action@v6",
  pagesConfigure: "actions/configure-pages@v6",
  pagesUpload: "actions/upload-pages-artifact@v5",
  pagesDeploy: "actions/deploy-pages@v5",
};

export interface StepPreset {
  label: string;
  /** One line on what it's for, shown in the picker and searched. */
  description: string;
  icon: string;
  group: (typeof STEP_GROUPS)[number];
  /** Some presets are a few steps that only make sense together (Pages: configure, upload, deploy). */
  steps: Step[];
  /** Token access the steps need; granted to the job they're added to, not the whole workflow. */
  permissions?: Record<string, "read" | "write">;
}

export const STEP_GROUPS = ["Basics", "Set up a language", "Files and speed", "Docker", "GitHub", "Publish"] as const;

const GH_TOKEN = { GH_TOKEN: "${{ github.token }}" };

/** Ready-made steps offered by "Add a step", by group. Everything is editable once added. */
export const STEP_PRESETS: Record<string, StepPreset> = {
  run: {
    label: "Run a command",
    description: "Any shell command, or several lines of them.",
    icon: "terminal",
    group: "Basics",
    steps: [{ name: "Run a command", run: "" }],
  },
  script: {
    label: "Run a script file",
    description: "A script from the repository, like ./scripts/build.sh.",
    icon: "file-code",
    group: "Basics",
    steps: [{ name: "Run a script", run: "./scripts/build.sh" }],
  },
  action: {
    label: "Use an action",
    description: "Any action from the GitHub Marketplace, with its inputs.",
    icon: "extensions",
    group: "Basics",
    steps: [{ uses: "", with: {} }],
  },
  checkout: {
    label: "Check out the code",
    description: "Get the repository's files. Most jobs start with this.",
    icon: "repo-clone",
    group: "Basics",
    steps: [{ uses: ACTIONS.checkout }],
  },
  "checkout-full": {
    label: "Check out with full history",
    description: "All commits and tags, for versioning, changelogs or blame.",
    icon: "history",
    group: "Basics",
    steps: [{ uses: ACTIONS.checkout, with: { "fetch-depth": 0 } }],
  },
  "set-env": {
    label: "Set a variable for later steps",
    description: "Make a value available to every step after this one.",
    icon: "symbol-variable",
    group: "Basics",
    steps: [{ name: "Set a variable", run: 'echo "NAME=value" >> "$GITHUB_ENV"' }],
  },
  summary: {
    label: "Write to the run summary",
    description: "Markdown shown on the run's page on GitHub.",
    icon: "markdown",
    group: "Basics",
    steps: [{ name: "Write a summary", run: 'echo "### Done :rocket:" >> "$GITHUB_STEP_SUMMARY"' }],
  },
  node: {
    label: "Set up Node.js",
    description: "Install a Node.js version (latest LTS by default).",
    icon: "symbol-event",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.node, with: { "node-version": "lts/*" } }],
  },
  pnpm: {
    label: "Set up pnpm",
    description: "Install pnpm, using the version in package.json's packageManager.",
    icon: "package",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.pnpm }],
  },
  bun: {
    label: "Set up Bun",
    description: "Install the Bun runtime.",
    icon: "flame",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.bun }],
  },
  python: {
    label: "Set up Python",
    description: "Install a Python version.",
    icon: "symbol-namespace",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.python, with: { "python-version": "3.13" } }],
  },
  go: {
    label: "Set up Go",
    description: "Install the latest stable Go.",
    icon: "symbol-method",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.go, with: { "go-version": "stable" } }],
  },
  java: {
    label: "Set up Java",
    description: "Install a JDK (Temurin 25, the current LTS).",
    icon: "coffee",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.java, with: { distribution: "temurin", "java-version": "25" } }],
  },
  dotnet: {
    label: "Set up .NET",
    description: "Install the .NET SDK (10, the current LTS).",
    icon: "symbol-class",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.dotnet, with: { "dotnet-version": "10.x" } }],
  },
  ruby: {
    label: "Set up Ruby",
    description: "Install Ruby and run bundle install, cached.",
    icon: "ruby",
    group: "Set up a language",
    steps: [{ uses: ACTIONS.ruby, with: { "ruby-version": "4.0", "bundler-cache": true } }],
  },
  rust: {
    label: "Set up Rust",
    description: "Install the stable Rust toolchain with rustup.",
    icon: "gear",
    group: "Set up a language",
    steps: [{ name: "Set up Rust", run: "rustup toolchain install stable --profile minimal" }],
  },
  cache: {
    label: "Cache files between runs",
    description: "Reuse downloads like dependencies, so runs are faster.",
    icon: "database",
    group: "Files and speed",
    steps: [
      {
        name: "Cache dependencies",
        uses: ACTIONS.cache,
        with: { path: "~/.npm", key: "${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}" },
      },
    ],
  },
  upload: {
    label: "Save files from the run",
    description: "Keep build output or reports, downloadable from the run's page.",
    icon: "cloud-upload",
    group: "Files and speed",
    steps: [{ name: "Upload files", uses: ACTIONS.upload, with: { name: "output", path: "dist" } }],
  },
  download: {
    label: "Use files from an earlier job",
    description: "Download files another job saved, by name.",
    icon: "cloud-download",
    group: "Files and speed",
    steps: [{ name: "Download files", uses: ACTIONS.download, with: { name: "output" } }],
  },
  "docker-login": {
    label: "Log in to GitHub's registry",
    description: "Sign in to ghcr.io with the run's own token, to push images.",
    icon: "key",
    group: "Docker",
    steps: [
      {
        uses: ACTIONS.dockerLogin,
        with: { registry: "ghcr.io", username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" },
      },
    ],
    permissions: { packages: "write" },
  },
  "docker-build": {
    label: "Build and push an image",
    description: "Build the Dockerfile and push it to ghcr.io (log in first).",
    icon: "package",
    group: "Docker",
    steps: [
      { uses: ACTIONS.buildx },
      {
        uses: ACTIONS.dockerBuild,
        with: { context: ".", push: true, tags: "ghcr.io/${{ github.repository }}:latest" },
      },
    ],
    permissions: { packages: "write" },
  },
  release: {
    label: "Create a GitHub release",
    description: "A release for the pushed tag, with notes from the commits.",
    icon: "tag",
    group: "GitHub",
    steps: [
      { name: "Create the release", run: 'gh release create "$GITHUB_REF_NAME" --generate-notes', env: GH_TOKEN },
    ],
    permissions: { contents: "write" },
  },
  "pr-comment": {
    label: "Comment on the pull request",
    description: "Post a comment on the PR that triggered the run.",
    icon: "comment",
    group: "GitHub",
    steps: [
      {
        name: "Comment on the pull request",
        if: "github.event_name == 'pull_request'",
        run: 'gh pr comment "${{ github.event.pull_request.number }}" --body "Build finished"',
        env: GH_TOKEN,
      },
    ],
    permissions: { "pull-requests": "write" },
  },
  label: {
    label: "Label the issue or pull request",
    description: "Add a label to the issue or PR that triggered the run.",
    icon: "tag",
    group: "GitHub",
    steps: [
      {
        name: "Add a label",
        run: 'gh issue edit "${{ github.event.issue.number || github.event.pull_request.number }}" --add-label "triage"',
        env: GH_TOKEN,
      },
    ],
    permissions: { issues: "write", "pull-requests": "write" },
  },
  pages: {
    label: "Deploy a folder to GitHub Pages",
    description: "Publish a folder as your site (turn Pages on with GitHub Actions as the source).",
    icon: "globe",
    group: "Publish",
    steps: [
      { uses: ACTIONS.pagesConfigure },
      { uses: ACTIONS.pagesUpload, with: { path: "dist" } },
      { id: "deployment", uses: ACTIONS.pagesDeploy },
    ],
    permissions: { pages: "write", "id-token": "write" },
  },
  "npm-publish": {
    label: "Publish to npm",
    description: "Publish the package with provenance (needs an NPM_TOKEN secret).",
    icon: "package",
    group: "Publish",
    steps: [
      { uses: ACTIONS.node, with: { "node-version": "lts/*", "registry-url": "https://registry.npmjs.org" } },
      { run: "npm ci" },
      {
        name: "Publish",
        run: "npm publish --provenance --access public",
        env: { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" },
      },
    ],
    permissions: { "id-token": "write" },
  },
  "pypi-publish": {
    label: "Publish to PyPI",
    description: "Build and upload with trusted publishing (no token to store).",
    icon: "package",
    group: "Publish",
    steps: [
      { uses: ACTIONS.python, with: { "python-version": "3.13" } },
      { run: "python -m pip install build && python -m build" },
      { name: "Publish", uses: "pypa/gh-action-pypi-publish@release/v1" },
    ],
    permissions: { "id-token": "write" },
  },
};

/**
 * Adds a preset's steps to a job, plus the access they need, for that job only. Returns the index
 * of the first added step and which permissions were granted, so the UI can say so.
 */
export function addPreset(job: Job, key: string, readOnlyDefault: boolean): { first: number; granted: string[] } {
  const preset = STEP_PRESETS[key];
  const first = job.steps?.length ?? 0;
  job.steps = [...(job.steps ?? []), ...structuredClone(preset.steps)];
  const granted: string[] = [];
  if (preset.permissions) {
    const extra = (job.extra ??= {});
    // A job's permissions replace the workflow's, so keep read access to the code when granting more.
    const current =
      (extra.permissions as Record<string, string> | undefined) ?? (readOnlyDefault ? { contents: "read" } : {});
    const merged: Record<string, string> = { ...current };
    for (const [scope, level] of Object.entries(preset.permissions)) {
      if (merged[scope] !== "write" && merged[scope] !== level) {
        merged[scope] = level;
        granted.push(`${scope} (${level})`);
      }
    }
    if (granted.length) extra.permissions = merged;
  }
  return { first, granted };
}

/** The steps a template job generates; "steps" jobs return their own. */
export function stepsFor(job: Job): Step[] {
  if (job.template === "steps") return job.steps ?? [];
  const input = (key: string) => job.inputs[key] ?? "";
  const version = (key: string) => (job.versions.length ? `\${{ matrix.${key} }}` : undefined);
  const checkout: Step = { uses: ACTIONS.checkout };

  switch (job.template) {
    case "node-lint":
    case "node-test":
    case "node-build":
      return [
        checkout,
        { uses: ACTIONS.node, with: { "node-version": version("node-version") ?? "lts/*", cache: "npm" } },
        { run: "npm ci" },
        { run: input("command") },
      ];
    case "python-lint":
      return [
        checkout,
        { uses: ACTIONS.python, with: { "python-version": "3.13" } },
        { run: "pip install ruff" },
        { run: input("command") },
      ];
    case "python-test":
      return [
        checkout,
        { uses: ACTIONS.python, with: { "python-version": version("python-version") ?? "3.13", cache: "pip" } },
        { run: input("install") },
        { run: input("command") },
      ];
    case "go-test":
      return [
        checkout,
        { uses: ACTIONS.go, with: { "go-version": version("go-version") ?? "stable" } },
        { run: input("command") },
      ];
    case "rust-test":
      return [checkout, { run: input("command") }];
    case "docker-build":
      return [
        checkout,
        { uses: ACTIONS.buildx },
        { uses: ACTIONS.dockerBuild, with: { context: input("context"), push: false } },
      ];
    case "docker-publish":
      return [
        checkout,
        { uses: ACTIONS.buildx },
        {
          uses: ACTIONS.dockerLogin,
          with: { registry: "ghcr.io", username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" },
        },
        // Tags the image from the git ref: branch name, tag (v1.2.3) and commit sha.
        { id: "meta", uses: ACTIONS.dockerMeta, with: { images: "ghcr.io/${{ github.repository }}" } },
        {
          uses: ACTIONS.dockerBuild,
          with: {
            context: input("context"),
            push: true,
            tags: "${{ steps.meta.outputs.tags }}",
            labels: "${{ steps.meta.outputs.labels }}",
          },
        },
      ];
    case "github-release":
      // gh ships with GitHub's runners, so no third-party action is needed.
      return [
        checkout,
        {
          name: "Create the release",
          run: 'gh release create "$GITHUB_REF_NAME" --generate-notes',
          env: { GH_TOKEN: "${{ github.token }}" },
        },
      ];
    case "pages-deploy":
      return [
        checkout,
        ...(input("build").trim() ? [{ name: "Build", run: input("build") }] : []),
        { uses: ACTIONS.pagesConfigure },
        { uses: ACTIONS.pagesUpload, with: { path: input("folder") } },
        { id: "deployment", uses: ACTIONS.pagesDeploy },
      ];
    case "custom":
      return [checkout, { run: input("command") }];
  }
}

/** Job-level keys a template adds besides steps: matrix, extra permissions, environment. */
export function templateKeys(job: Job): Record<string, unknown> {
  if (job.template === "steps") return {};
  const t = template(job.template);
  const keys: Record<string, unknown> = {};
  // Extra permissions go on the job that needs them, never the whole workflow.
  if (t.permissions) keys.permissions = { contents: "read", ...t.permissions };
  if (job.template === "pages-deploy") {
    keys.environment = { name: "github-pages", url: "${{ steps.deployment.outputs.page_url }}" };
  }
  if (t.matrixKey && job.versions.length) keys.strategy = { matrix: { [t.matrixKey]: job.versions } };
  return keys;
}

/** Turns a template job into a "steps" job with the same behaviour, so every step can be edited. */
export function toOwnSteps(job: Job): Job {
  if (job.template === "steps") return job;
  return {
    ...job,
    template: "steps",
    steps: structuredClone(stepsFor(job)),
    extra: { ...templateKeys(job), ...job.extra },
    inputs: {},
    versions: [],
  };
}

// --- Schedules ------------------------------------------------------------------------------

export type Frequency = "hourly" | "daily" | "weekly" | "monthly";

export interface ScheduleSpec {
  frequency: Frequency;
  minute: number;
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Day of the month, 1–28 (29–31 don't exist every month). */
  day: number;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function cronFor(s: ScheduleSpec): string {
  switch (s.frequency) {
    case "hourly":
      return `${s.minute} * * * *`;
    case "daily":
      return `${s.minute} ${s.hour} * * *`;
    case "weekly":
      return `${s.minute} ${s.hour} * * ${s.weekday}`;
    case "monthly":
      return `${s.minute} ${s.hour} ${s.day} * *`;
  }
}

/** Reads back a cron written by cronFor; anything fancier returns null (shown as a custom schedule). */
export function scheduleSpec(cron: string): ScheduleSpec | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5 || parts[3] !== "*") return null;
  const [m, h, d, , w] = parts;
  const n = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const base = { minute: n(m), hour: 6, weekday: 1, day: 1 };
  if (Number.isNaN(base.minute) || base.minute > 59) return null;
  if (h === "*" && d === "*" && w === "*") return { ...base, frequency: "hourly" };
  const hour = n(h);
  if (Number.isNaN(hour) || hour > 23) return null;
  if (d === "*" && w === "*") return { ...base, hour, frequency: "daily" };
  if (d === "*" && n(w) <= 6) return { ...base, hour, weekday: n(w), frequency: "weekly" };
  if (w === "*" && n(d) >= 1 && n(d) <= 28) return { ...base, hour, day: n(d), frequency: "monthly" };
  return null;
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
  const noTriggers = !t.push.enabled && !t.pullRequest.enabled && !t.tags.enabled && !t.schedule.enabled && !t.manual;
  // Triggers kept as written (rawOn) count, even though the chips can't show them.
  if (model.rawOn === undefined && noTriggers) {
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
    // A job that calls a reusable workflow (uses: at job level) has no steps of its own.
    if (job.template === "steps" && !job.extra?.uses) {
      const steps = job.steps ?? [];
      if (steps.length === 0) problems.push({ job: job.id, message: `${job.name} has no steps yet.` });
      steps.forEach((step, i) => {
        if (!String(step.run ?? "").trim() && !String(step.uses ?? "").trim()) {
          problems.push({ job: job.id, message: `${job.name}, step ${i + 1}: add a command or an action.` });
        }
      });
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

export function describeSchedule(cron: string): string {
  const spec = scheduleSpec(cron);
  if (!spec) return `on schedule "${cron.trim()}"`;
  const time = `${String(spec.hour).padStart(2, "0")}:${String(spec.minute).padStart(2, "0")} UTC`;
  const nth = (d: number) =>
    `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
  switch (spec.frequency) {
    case "hourly":
      return spec.minute ? `every hour at :${String(spec.minute).padStart(2, "0")}` : "every hour";
    case "daily":
      return `every day at ${time}`;
    case "weekly":
      return `every ${WEEKDAYS[spec.weekday]} at ${time}`;
    case "monthly":
      return `on the ${nth(spec.day)} of every month at ${time}`;
  }
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
