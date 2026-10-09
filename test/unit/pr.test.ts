import { describe, expect, it } from "vitest";
import {
  COMMIT_LOG_FORMAT,
  compareUrl,
  parseCommitLog,
  prDraft,
  pullFromGraphql,
  pullFromRest,
  readiness,
  type RestReview,
} from "../../src/github/pr";
import { commit, git, makeRepo } from "../fixtures/repos";
import type { CiStatus, PullRequest } from "../../src/shared/types";

// Shapes as GitHub returns them (trimmed to the fields GitKit asks for or reads).
const graphql = (nodes: unknown[]) => ({ data: { repository: { pullRequests: { nodes } } } });
const node = (overrides: Record<string, unknown> = {}) => ({
  number: 42,
  title: "feat: health endpoint",
  url: "https://github.com/octo/demo/pull/42",
  isDraft: false,
  baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  headRepositoryOwner: { login: "octo" },
  reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
  ...overrides,
});

const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 42,
  title: "t",
  url: "u",
  draft: false,
  base: "main",
  review: null,
  unresolved: 0,
  mergeable: "clean",
  ...overrides,
});
const ci = (state: CiStatus["state"]): CiStatus => ({ state, sha: "s", summary: "", failed: [], url: "", runId: null });

describe("pullFromGraphql", () => {
  it("reads the PR, its review decision and unresolved threads", () => {
    expect(pullFromGraphql(graphql([node()]), "octo")).toEqual({
      number: 42,
      title: "feat: health endpoint",
      url: "https://github.com/octo/demo/pull/42",
      draft: false,
      base: "main",
      review: "required",
      unresolved: 2,
      mergeable: "clean",
    });
  });

  it.each([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes"],
    [null, null],
  ])("maps the review decision %s", (decision, review) => {
    expect(pullFromGraphql(graphql([node({ reviewDecision: decision })]), "octo")?.review).toBe(review);
  });

  it.each([
    ["CONFLICTING", "conflicts"],
    ["UNKNOWN", "unknown"],
  ])("maps mergeable %s", (mergeable, expected) => {
    expect(pullFromGraphql(graphql([node({ mergeable })]), "octo")?.mergeable).toBe(expected);
  });

  it("ignores PRs from forks that use the same branch name", () => {
    const fork = node({ number: 7, headRepositoryOwner: { login: "someone-else" } });
    expect(pullFromGraphql(graphql([fork, node()]), "OCTO")?.number).toBe(42);
    expect(pullFromGraphql(graphql([fork]), "octo")).toBeNull();
  });

  it("returns null when there's no open PR or the answer is an error", () => {
    expect(pullFromGraphql(graphql([]), "octo")).toBeNull();
    expect(pullFromGraphql({ errors: [{ message: "Bad credentials" }] }, "octo")).toBeNull();
    expect(pullFromGraphql(null, "octo")).toBeNull();
  });
});

describe("pullFromRest", () => {
  const pull = {
    number: 5,
    title: "fix: typo",
    html_url: "https://github.com/octo/demo/pull/5",
    draft: true,
    base: { ref: "develop" },
    mergeable: null,
  };
  const review = (login: string, state: RestReview["state"]): RestReview => ({ user: { login }, state });

  it("reads the PR, leaving what REST can't tell as unknown", () => {
    expect(pullFromRest(pull, [])).toEqual({
      number: 5,
      title: "fix: typo",
      url: "https://github.com/octo/demo/pull/5",
      draft: true,
      base: "develop",
      review: null,
      unresolved: null,
      mergeable: "unknown",
    });
    expect(pullFromRest({ ...pull, mergeable: false }, []).mergeable).toBe("conflicts");
  });

  it("uses each reviewer's latest verdict, ignoring plain comments", () => {
    expect(pullFromRest(pull, [review("a", "CHANGES_REQUESTED"), review("a", "APPROVED")]).review).toBe("approved");
    expect(pullFromRest(pull, [review("a", "APPROVED"), review("a", "COMMENTED")]).review).toBe("approved");
    expect(pullFromRest(pull, [review("a", "APPROVED"), review("b", "CHANGES_REQUESTED")]).review).toBe("changes");
    expect(pullFromRest(pull, [review("a", "APPROVED"), review("a", "DISMISSED")]).review).toBeNull();
    expect(pullFromRest(pull, [{ user: null, state: "APPROVED" }]).review).toBeNull();
  });
});

describe("readiness", () => {
  const text = (r: ReturnType<typeof readiness>) => r.parts.map((p) => p.text).join(", ");

  it("is ready when CI passes, it's approved, nothing is unresolved and it merges cleanly", () => {
    const r = readiness(pr({ review: "approved" }), ci("success"), null);
    expect(text(r)).toBe("CI passing, approved, merges cleanly");
    expect(r.ready).toBe(true);
    expect(r.parts.every((p) => p.tone === "ok")).toBe(true);
  });

  it("says what's missing", () => {
    const r = readiness(pr({ review: "required", unresolved: 2 }), ci("pending"), null);
    expect(text(r)).toBe("CI running, review needed, 2 unresolved comments, merges cleanly");
    expect(r.ready).toBe(false);
    expect(text(readiness(pr({ unresolved: 1 }), null, null))).toBe("1 unresolved comment, merges cleanly");
  });

  it.each([
    [pr({ draft: true }), ci("success"), "draft"],
    [pr(), ci("failure"), "CI failing"],
    [pr({ review: "changes" }), ci("success"), "changes requested"],
    [pr({ mergeable: "conflicts" }), ci("success"), "has conflicts"],
  ])("isn't ready: %#", (p, c, part) => {
    const r = readiness(p, c, null);
    expect(r.ready).toBe(false);
    expect(text(r)).toContain(part);
  });

  it("is ready without reviews when the branch doesn't require them, and without CI when there is none", () => {
    expect(readiness(pr(), ci("none"), null).ready).toBe(true);
    expect(readiness(pr(), null, null).ready).toBe(true);
  });

  it("uses GitKit's own merge forecast while GitHub hasn't worked out mergeability", () => {
    expect(text(readiness(pr({ mergeable: "unknown" }), null, ["app.ts"]))).toBe("has conflicts");
    expect(text(readiness(pr({ mergeable: "unknown" }), null, []))).toBe("merges cleanly");
    const unknown = readiness(pr({ mergeable: "unknown" }), null, null);
    expect(text(unknown)).toBe("");
    expect(unknown.ready).toBe(false);
    // GitHub's answer wins over the forecast.
    expect(text(readiness(pr({ mergeable: "clean" }), null, ["app.ts"]))).toBe("merges cleanly");
  });
});

describe("prDraft", () => {
  const commit = (subject: string, body = "") => ({ subject, body });

  it("uses a single commit's message as is", () => {
    expect(prDraft("feat/x", [commit("feat: add login", "Adds a form.\n\nCloses #3.\n")])).toEqual({
      title: "feat: add login",
      body: "Adds a form.\n\nCloses #3.",
    });
  });

  it("titles several commits from the branch name and lists them oldest first", () => {
    expect(prDraft("feat/health-endpoint", [commit("test: cover it"), commit("feat: add /health")])).toEqual({
      title: "feat: health endpoint",
      body: "- feat: add /health\n- test: cover it",
    });
  });

  it.each([
    ["fix/login_redirect", "fix: login redirect"],
    ["Fix/thing", "fix: thing"],
    ["testing-1", "Testing 1"],
    ["sam/new-ui", "Sam new ui"],
  ])("%s → %s", (head, title) => {
    expect(prDraft(head, [commit("a"), commit("b")]).title).toBe(title);
  });
});

describe("parseCommitLog", () => {
  it("reads subjects and multi-line bodies from real git log output, newest first", () => {
    const dir = makeRepo();
    commit(dir, "feat: add /health");
    commit(dir, "fix: handle timeouts", {}, "Retries twice.\n\nCloses #12.");
    commit(dir, "docs: say what | and ; mean");
    const out = git(dir, "log", COMMIT_LOG_FORMAT, "-3");
    expect(parseCommitLog(out)).toEqual([
      { subject: "docs: say what | and ; mean", body: "" },
      { subject: "fix: handle timeouts", body: "Retries twice.\n\nCloses #12." },
      { subject: "feat: add /health", body: "" },
    ]);
  });

  it("reads nothing from an empty range", () => {
    expect(parseCommitLog("")).toEqual([]);
  });
});

describe("compareUrl", () => {
  const gh = { owner: "octo", repo: "demo" };

  it("links to GitHub's new pull request page with the draft filled in", () => {
    const url = new URL(compareUrl(gh, "main", "feat/login", { title: "feat: login & logout", body: "- a\n- b" }));
    expect(url.origin + url.pathname).toBe("https://github.com/octo/demo/compare/main...feat/login");
    expect(url.searchParams.get("expand")).toBe("1");
    expect(url.searchParams.get("title")).toBe("feat: login & logout");
    expect(url.searchParams.get("body")).toBe("- a\n- b");
  });

  it("escapes branch names but keeps their slashes", () => {
    expect(compareUrl(gh, "release/1.0", "fix/#12", undefined)).toBe(
      "https://github.com/octo/demo/compare/release/1.0...fix/%2312?expand=1",
    );
  });
});
