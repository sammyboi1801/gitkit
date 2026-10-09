import { describeSchedule } from "./model";

// Every event a workflow can run on, in plain words, with the options GitHub gives each one. The
// trigger editor is built from this list, so any event can be set up with controls instead of YAML.
// A test checks it against GitHub's workflow schema, so no event or activity type goes missing.

export type Filter = "branches" | "tags" | "paths";
export type EventGroup =
  "Code" | "Pull requests" | "Releases and deployments" | "Issues and discussions" | "Automation" | "Repository";

export interface EventSpec {
  event: string;
  /** In the "Add a trigger" menu: "When code is pushed". */
  label: string;
  /** One line under it. */
  description: string;
  group: EventGroup;
  icon: string;
  /** Filters it supports, each with an "-ignore" twin. */
  filters?: Filter[];
  /** Activity types, and the ones GitHub uses when none are listed. */
  types?: string[];
  defaultTypes?: string[];
  /** Types are free text (repository_dispatch). */
  customTypes?: boolean;
  /** Its own editor: schedules, Run-button inputs, reusable-workflow inputs, other workflows. */
  special?: "schedule" | "dispatch" | "call" | "workflow_run";
}

const ALL = <T extends string>(...types: T[]) => types;

export const EVENTS: EventSpec[] = [
  // Code
  {
    event: "push",
    label: "When code is pushed",
    description: "To any branch, or only some; for version tags too.",
    group: "Code",
    icon: "repo-push",
    filters: ["branches", "tags", "paths"],
  },
  {
    event: "create",
    label: "When a branch or tag is created",
    description: "Runs on the new branch or tag.",
    group: "Code",
    icon: "git-branch",
  },
  {
    event: "delete",
    label: "When a branch or tag is deleted",
    description: "Runs on the default branch.",
    group: "Code",
    icon: "trash",
  },
  // Pull requests
  {
    event: "pull_request",
    label: "On pull requests",
    description: "Opened, updated or reopened, by default.",
    group: "Pull requests",
    icon: "git-pull-request",
    filters: ["branches", "paths"],
    types: ALL(
      "assigned",
      "unassigned",
      "labeled",
      "unlabeled",
      "opened",
      "edited",
      "closed",
      "reopened",
      "synchronize",
      "converted_to_draft",
      "ready_for_review",
      "locked",
      "unlocked",
      "milestoned",
      "demilestoned",
      "review_requested",
      "review_request_removed",
      "auto_merge_enabled",
      "auto_merge_disabled",
      "enqueued",
      "dequeued",
    ),
    defaultTypes: ["opened", "synchronize", "reopened"],
  },
  {
    event: "pull_request_target",
    label: "On pull requests, with write access",
    description: "Runs in the base repository, with secrets, even for forks. Never run the pull request's code here.",
    group: "Pull requests",
    icon: "shield",
    filters: ["branches", "paths"],
    types: ALL(
      "assigned",
      "unassigned",
      "labeled",
      "unlabeled",
      "opened",
      "edited",
      "closed",
      "reopened",
      "synchronize",
      "converted_to_draft",
      "ready_for_review",
      "locked",
      "unlocked",
      "review_requested",
      "review_request_removed",
      "auto_merge_enabled",
      "auto_merge_disabled",
    ),
    defaultTypes: ["opened", "synchronize", "reopened"],
  },
  {
    event: "pull_request_review",
    label: "When a pull request is reviewed",
    description: "A review is submitted, edited or dismissed.",
    group: "Pull requests",
    icon: "eye",
    types: ALL("submitted", "edited", "dismissed"),
  },
  {
    event: "pull_request_review_comment",
    label: "On review comments",
    description: "A comment on a pull request's changes.",
    group: "Pull requests",
    icon: "comment",
    types: ALL("created", "edited", "deleted"),
  },
  {
    event: "merge_group",
    label: "In the merge queue",
    description: "Checks a group of pull requests before they merge.",
    group: "Pull requests",
    icon: "git-merge",
    types: ALL("checks_requested"),
  },
  // Releases and deployments
  {
    event: "release",
    label: "When a release is published",
    description: "Or created, edited, pre-released and so on.",
    group: "Releases and deployments",
    icon: "rocket",
    types: ALL("published", "unpublished", "created", "edited", "deleted", "prereleased", "released"),
    defaultTypes: ["published", "unpublished", "created", "edited", "deleted", "prereleased", "released"],
  },
  {
    event: "registry_package",
    label: "When a package is published",
    description: "To GitHub Packages, or updated there.",
    group: "Releases and deployments",
    icon: "package",
    types: ALL("published", "updated"),
  },
  {
    event: "deployment",
    label: "When a deployment is created",
    description: "Through the API or another workflow.",
    group: "Releases and deployments",
    icon: "cloud-upload",
  },
  {
    event: "deployment_status",
    label: "When a deployment's status changes",
    description: "Success, failure, in progress and so on.",
    group: "Releases and deployments",
    icon: "pulse",
  },
  {
    event: "page_build",
    label: "When GitHub Pages builds",
    description: "After a push to the Pages branch.",
    group: "Releases and deployments",
    icon: "globe",
  },
  // Issues and discussions
  {
    event: "issues",
    label: "On issues",
    description: "Opened, edited, closed, labeled and so on.",
    group: "Issues and discussions",
    icon: "issues",
    types: ALL(
      "opened",
      "edited",
      "deleted",
      "transferred",
      "pinned",
      "unpinned",
      "closed",
      "reopened",
      "assigned",
      "unassigned",
      "labeled",
      "unlabeled",
      "locked",
      "unlocked",
      "milestoned",
      "demilestoned",
      "typed",
      "untyped",
      "field_added",
      "field_removed",
    ),
  },
  {
    event: "issue_comment",
    label: "On issue and pull request comments",
    description: "A comment is added, edited or deleted.",
    group: "Issues and discussions",
    icon: "comment-discussion",
    types: ALL("created", "edited", "deleted"),
  },
  {
    event: "discussion",
    label: "On discussions",
    description: "Created, answered, labeled and so on.",
    group: "Issues and discussions",
    icon: "comment-discussion",
    types: ALL(
      "created",
      "edited",
      "deleted",
      "transferred",
      "pinned",
      "unpinned",
      "labeled",
      "unlabeled",
      "locked",
      "unlocked",
      "category_changed",
      "answered",
      "unanswered",
    ),
  },
  {
    event: "discussion_comment",
    label: "On discussion comments",
    description: "A comment is added, edited or deleted.",
    group: "Issues and discussions",
    icon: "comment",
    types: ALL("created", "edited", "deleted"),
  },
  {
    event: "label",
    label: "When a label changes",
    description: "Created, edited or deleted.",
    group: "Issues and discussions",
    icon: "tag",
    types: ALL("created", "edited", "deleted"),
  },
  {
    event: "milestone",
    label: "When a milestone changes",
    description: "Created, opened, closed, edited or deleted.",
    group: "Issues and discussions",
    icon: "milestone",
    types: ALL("created", "closed", "opened", "edited", "deleted"),
  },
  // Automation
  {
    event: "schedule",
    label: "On a schedule",
    description: "Every day, every Monday, or any cron.",
    group: "Automation",
    icon: "watch",
    special: "schedule",
  },
  {
    event: "workflow_dispatch",
    label: "With a Run button on GitHub",
    description: "Start it by hand, with inputs if you like.",
    group: "Automation",
    icon: "play",
    special: "dispatch",
  },
  {
    event: "workflow_call",
    label: "When another workflow calls it",
    description: "Makes this a reusable workflow, with its own inputs.",
    group: "Automation",
    icon: "references",
    special: "call",
  },
  {
    event: "workflow_run",
    label: "After another workflow",
    description: "When it's requested or completes.",
    group: "Automation",
    icon: "debug-continue",
    special: "workflow_run",
    filters: ["branches"],
    types: ALL("requested", "completed", "in_progress"),
    defaultTypes: ["requested", "completed"],
  },
  {
    event: "repository_dispatch",
    label: "From an API call",
    description: "A webhook or script sends it, with a type you choose.",
    group: "Automation",
    icon: "plug",
    customTypes: true,
  },
  {
    event: "check_run",
    label: "When a check run changes",
    description: "Created, completed, re-requested.",
    group: "Automation",
    icon: "checklist",
    types: ALL("created", "rerequested", "completed", "requested_action"),
  },
  {
    event: "check_suite",
    label: "When a check suite changes",
    description: "Completed, requested or re-requested.",
    group: "Automation",
    icon: "checklist",
    types: ALL("completed", "requested", "rerequested"),
  },
  {
    event: "status",
    label: "When a commit status changes",
    description: "From an outside CI or tool.",
    group: "Automation",
    icon: "circle-large-outline",
  },
  // Repository
  {
    event: "watch",
    label: "When someone stars the repo",
    description: "Each new star.",
    group: "Repository",
    icon: "star-empty",
  },
  {
    event: "fork",
    label: "When the repo is forked",
    description: "Each new fork.",
    group: "Repository",
    icon: "repo-forked",
  },
  {
    event: "public",
    label: "When the repo is made public",
    description: "Once, when it changes from private.",
    group: "Repository",
    icon: "unlock",
  },
  {
    event: "gollum",
    label: "When the wiki changes",
    description: "A page is created or edited.",
    group: "Repository",
    icon: "book",
  },
  {
    event: "branch_protection_rule",
    label: "When branch protection changes",
    description: "A rule is created, edited or deleted.",
    group: "Repository",
    icon: "lock",
    types: ALL("created", "edited", "deleted"),
  },
  {
    event: "project",
    label: "On classic projects",
    description: "A project is created, closed, edited and so on.",
    group: "Repository",
    icon: "project",
    types: ALL("created", "updated", "closed", "reopened", "edited", "deleted"),
  },
  {
    event: "project_card",
    label: "On classic project cards",
    description: "A card is created, moved or converted.",
    group: "Repository",
    icon: "note",
    types: ALL("created", "moved", "converted", "edited", "deleted"),
  },
  {
    event: "project_column",
    label: "On classic project columns",
    description: "A column is created, moved or deleted.",
    group: "Repository",
    icon: "layout",
    types: ALL("created", "updated", "moved", "deleted"),
  },
];

export const EVENT_GROUPS: EventGroup[] = [
  "Code",
  "Pull requests",
  "Releases and deployments",
  "Issues and discussions",
  "Automation",
  "Repository",
];

export const eventSpec = (event: string): EventSpec | undefined => EVENTS.find((e) => e.event === event);

/** Activity types in words, where GitHub's names aren't already plain. */
const TYPE_WORDS: Record<string, string> = {
  synchronize: "updated with new commits",
  converted_to_draft: "turned into a draft",
  ready_for_review: "marked ready for review",
  review_requested: "review requested",
  review_request_removed: "review request removed",
  auto_merge_enabled: "auto-merge turned on",
  auto_merge_disabled: "auto-merge turned off",
  enqueued: "added to the merge queue",
  dequeued: "removed from the merge queue",
  checks_requested: "checks requested",
  prereleased: "pre-released",
  in_progress: "in progress",
  requested_action: "action requested",
  rerequested: "re-requested",
  category_changed: "moved to another category",
  field_added: "field added",
  field_removed: "field removed",
};
export const typeWords = (type: string) => TYPE_WORDS[type] ?? type.replace(/_/g, " ");

// --- Reading an event's config ---------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
const list = (items: string[], max = 3) =>
  items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} +${items.length - max} more`;

/** `on:` as a mapping, however it's written: `push`, `[push, pull_request]` or the full form. */
export function normalizeOn(on: unknown): Record<string, unknown> {
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [String(e), null]));
  return isObj(on) ? { ...on } : {};
}

/** A filter's two sides: "only these" or "all except these". */
export function filterOf(config: unknown, filter: Filter): { mode: "only" | "except"; values: string[] } | null {
  if (!isObj(config)) return null;
  if (config[filter] !== undefined) return { mode: "only", values: strings(config[filter]) };
  if (config[`${filter}-ignore`] !== undefined) return { mode: "except", values: strings(config[`${filter}-ignore`]) };
  return null;
}

/** The activity types it runs on, or null for GitHub's defaults. */
export const typesOf = (config: unknown): string[] | null =>
  isObj(config) && config.types !== undefined ? strings(config.types) : null;

function typesText(spec: EventSpec | undefined, config: unknown): string {
  const types = typesOf(config);
  // Only worth saying when it narrows things down: not for GitHub's defaults, or an event's only type.
  if (!types || !types.length || !spec?.types) return "";
  const defaults = spec.defaultTypes ?? spec.types;
  if ([...types].sort().join() === [...defaults].sort().join()) return "";
  return ` (${list(types.map(typeWords))})`;
}

function pathsText(config: unknown): string {
  const paths = filterOf(config, "paths");
  if (!paths?.values.length) return "";
  return paths.mode === "only"
    ? ` that change ${list(paths.values, 2)}`
    : // paths-ignore skips a run only when every changed file matches.
      ` unless only ${list(paths.values, 2)} changed`;
}

/** One trigger as part of a sentence: "on pushes to main", "every day at 06:00 UTC". */
export function describeEvent(event: string, config: unknown): string {
  const spec = eventSpec(event);
  switch (event) {
    case "push": {
      const branches = filterOf(config, "branches");
      const tags = filterOf(config, "tags");
      const parts: string[] = [];
      if (branches?.values.length) {
        parts.push(
          branches.mode === "only"
            ? `on pushes to ${list(branches.values)}`
            : `on pushes except to ${list(branches.values)}`,
        );
      } else if (!tags) parts.push(filterOf(config, "paths")?.values.length ? "on pushes" : "on every push");
      if (tags?.values.length)
        parts.push(tags.mode === "only" ? `on tags like ${list(tags.values)}` : `on tags except ${list(tags.values)}`);
      return parts.join(" and ") + pathsText(config);
    }
    case "pull_request":
    case "pull_request_target": {
      const branches = filterOf(config, "branches");
      const into = branches?.values.length
        ? branches.mode === "only"
          ? ` into ${list(branches.values)}`
          : ` except into ${list(branches.values)}`
        : "";
      const what = event === "pull_request" ? "on pull requests" : "on pull requests, with write access";
      return `${what}${into}${typesText(spec, config)}${pathsText(config)}`;
    }
    case "schedule": {
      const entries = Array.isArray(config) ? (config as Obj[]) : [];
      if (!entries.length) return "on a schedule";
      const first = entries[0];
      const zone = typeof first?.timezone === "string" ? describeZone(String(first.cron ?? ""), first.timezone) : null;
      const text = zone ?? describeSchedule(String(first?.cron ?? ""));
      return entries.length > 1 ? `${text} +${entries.length - 1} more` : text;
    }
    case "workflow_dispatch": {
      const inputs = isObj(config) && isObj(config.inputs) ? Object.keys(config.inputs).length : 0;
      return inputs ? `with a Run button (${inputs} input${inputs === 1 ? "" : "s"})` : "with a Run button";
    }
    case "workflow_call":
      return "when another workflow calls it";
    case "workflow_run": {
      const workflows = isObj(config) ? strings(config.workflows) : [];
      const types = typesOf(config);
      const when =
        types?.length === 1 ? (types[0] === "completed" ? "completes" : `is ${typeWords(types[0])}`) : "runs";
      return workflows.length ? `after ${list(workflows)} ${when}` : "after another workflow";
    }
    case "repository_dispatch": {
      const types = typesOf(config);
      return types?.length ? `from an API call (${list(types)})` : "from an API call";
    }
    case "release": {
      const types = typesOf(config);
      if (types?.length === 1) return `when a release is ${typeWords(types[0])}`;
      return types?.length ? `on releases (${list(types.map(typeWords))})` : "on any release activity";
    }
    default: {
      // "When the repo is forked" → "when the repo is forked", as part of a sentence.
      const label = spec ? spec.label.charAt(0).toLowerCase() + spec.label.slice(1) : `on ${event}`;
      return `${label}${typesText(spec, config)}`;
    }
  }
}

/** A schedule in a timezone: GitHub reads the cron in that zone instead of UTC. */
function describeZone(cron: string, zone: string): string {
  return describeSchedule(cron).replace(/ UTC\b/, ` ${zone.split("/").pop()!.replace(/_/g, " ")} time`);
}

/** Common timezones for schedules, by city: GitHub takes any IANA name. */
export const TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];
