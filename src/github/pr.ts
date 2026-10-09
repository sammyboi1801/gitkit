import type { CiStatus, PullRequest } from "../shared/types";

// Pure helpers for pull requests: reading GitHub's answers, the one-line readiness summary, and
// the title and description a new PR starts with.

/** Signed in: one GraphQL query gets everything, including unresolved review threads. */
export const PR_QUERY = `query($owner: String!, $repo: String!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $head, states: OPEN, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        isDraft
        baseRefName
        reviewDecision
        mergeable
        headRepositoryOwner { login }
        reviewThreads(first: 100) { nodes { isResolved } }
      }
    }
  }
}`;

interface GraphqlPull {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  baseRefName: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  headRepositoryOwner: { login: string } | null;
  reviewThreads: { nodes: { isResolved: boolean }[] };
}

/**
 * The open PR from `owner`'s branch in a GraphQL answer. headRefName alone also matches PRs from
 * forks that happen to use the same branch name, so the head's owner has to match too.
 */
export function pullFromGraphql(body: unknown, owner: string): PullRequest | null {
  const nodes = (body as { data?: { repository?: { pullRequests?: { nodes?: GraphqlPull[] } } } })?.data?.repository
    ?.pullRequests?.nodes;
  const pull = nodes?.find((n) => n.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase());
  if (!pull) return null;
  const review = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "required" } as const;
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    draft: pull.isDraft,
    base: pull.baseRefName,
    review: pull.reviewDecision ? review[pull.reviewDecision] : null,
    unresolved: pull.reviewThreads.nodes.filter((t) => !t.isResolved).length,
    mergeable: pull.mergeable === "MERGEABLE" ? "clean" : pull.mergeable === "CONFLICTING" ? "conflicts" : "unknown",
  };
}

/** The subset of the REST pull request object GitKit reads. */
export interface RestPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  base: { ref: string };
  /** null while GitHub is still working it out. */
  mergeable?: boolean | null;
}

export interface RestReview {
  user: { login: string } | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | string;
}

/**
 * Not signed in (public repos): the REST API has the PR and its reviews but not review threads, nor
 * whether reviews are required, so the decision is worked out from each reviewer's latest verdict.
 */
export function pullFromRest(pull: RestPull, reviews: readonly RestReview[]): PullRequest {
  const latest = new Map<string, string>();
  for (const r of reviews) {
    // Comments don't change a verdict; a dismissal withdraws it.
    if (!r.user || r.state === "COMMENTED" || r.state === "PENDING") continue;
    latest.set(r.user.login, r.state);
  }
  const verdicts = [...latest.values()];
  return {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    draft: !!pull.draft,
    base: pull.base.ref,
    review: verdicts.includes("CHANGES_REQUESTED") ? "changes" : verdicts.includes("APPROVED") ? "approved" : null,
    unresolved: null,
    mergeable: pull.mergeable === true ? "clean" : pull.mergeable === false ? "conflicts" : "unknown",
  };
}

export interface ReadinessPart {
  text: string;
  tone: "ok" | "warn" | "bad" | "muted";
}

/**
 * "PR #42: CI passing, approved, merges cleanly", as parts the UI can colour. `conflicts` is
 * GitKit's own merge forecast, used while GitHub hasn't worked out mergeability yet.
 */
export function readiness(
  pr: PullRequest,
  ci: CiStatus | null | undefined,
  conflicts: readonly string[] | null | undefined,
): { ready: boolean; parts: ReadinessPart[] } {
  const parts: ReadinessPart[] = [];
  if (pr.draft) parts.push({ text: "draft", tone: "muted" });

  if (ci?.state === "success") parts.push({ text: "CI passing", tone: "ok" });
  else if (ci?.state === "failure") parts.push({ text: "CI failing", tone: "bad" });
  else if (ci?.state === "pending") parts.push({ text: "CI running", tone: "warn" });

  if (pr.review === "approved") parts.push({ text: "approved", tone: "ok" });
  else if (pr.review === "changes") parts.push({ text: "changes requested", tone: "bad" });
  else if (pr.review === "required") parts.push({ text: "review needed", tone: "warn" });

  if (pr.unresolved) {
    parts.push({ text: `${pr.unresolved} unresolved comment${pr.unresolved === 1 ? "" : "s"}`, tone: "warn" });
  }

  const mergeable =
    pr.mergeable !== "unknown" ? pr.mergeable : conflicts?.length ? "conflicts" : conflicts ? "clean" : "unknown";
  if (mergeable === "clean") parts.push({ text: "merges cleanly", tone: "ok" });
  else if (mergeable === "conflicts") parts.push({ text: "has conflicts", tone: "bad" });

  const ready =
    !pr.draft &&
    ci?.state !== "failure" &&
    ci?.state !== "pending" &&
    (pr.review === "approved" || pr.review === null) &&
    !pr.unresolved &&
    mergeable === "clean";
  return { ready, parts };
}

/** `git log` format for parseCommitLog: subject and body, unit- and record-separated. */
export const COMMIT_LOG_FORMAT = "--format=%s%x1f%b%x1e";

/** Commits from `git log` with COMMIT_LOG_FORMAT, newest first. */
export function parseCommitLog(out: string): { subject: string; body: string }[] {
  return out
    .split("\x1e")
    .filter((record) => record.trim())
    .map((record) => {
      const [subject, body = ""] = record.split("\x1f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

const COMMIT_TYPES = new Set(["feat", "fix", "chore", "docs", "refactor", "test", "ci", "perf", "build", "style"]);

/**
 * What a new PR starts with. One commit: its message. Several: a title from the branch name
 * (feat/health-endpoint → "feat: health endpoint") and the commits as a list, oldest first.
 * `commits` are newest first, the way git log lists them.
 */
export function prDraft(
  head: string,
  commits: readonly { subject: string; body: string }[],
): { title: string; body: string } {
  if (commits.length === 1) return { title: commits[0].subject, body: commits[0].body.trim() };
  const slash = head.indexOf("/");
  const prefix = slash > 0 ? head.slice(0, slash).toLowerCase() : "";
  const words = (slash > 0 && COMMIT_TYPES.has(prefix) ? head.slice(slash + 1) : head).replace(/[-_/]+/g, " ").trim();
  const title = COMMIT_TYPES.has(prefix) ? `${prefix}: ${words}` : words.charAt(0).toUpperCase() + words.slice(1);
  const body = commits.length
    ? [...commits]
        .reverse()
        .map((c) => `- ${c.subject}`)
        .join("\n")
    : "";
  return { title, body };
}

/** GitHub's "open a pull request" page with the title and description filled in. */
export function compareUrl(
  gh: { owner: string; repo: string },
  base: string,
  head: string,
  draft?: { title: string; body: string },
): string {
  const query = new URLSearchParams({ expand: "1" });
  if (draft) {
    query.set("title", draft.title);
    if (draft.body) query.set("body", draft.body);
  }
  const ref = (name: string) => name.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${gh.owner}/${gh.repo}/compare/${ref(base)}...${ref(head)}?${query}`;
}
